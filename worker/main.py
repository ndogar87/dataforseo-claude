"""FastAPI entry point for the SEO worker.

Exposes:
  * `GET  /health` — liveness probe used by Railway / Trigger.dev.
  * `POST /run`    — kicks off the Claude agent loop for a single task.

`POST /run` is authenticated by an ``X-Worker-Secret`` header that must
match the ``WORKER_SHARED_SECRET`` env var. The web side dispatches one
POST per task; the body carries only ``task_id``, ``type``, and
``params``. Supabase writes are authenticated with the worker's own
``SUPABASE_SERVICE_ROLE_KEY`` env var — we deliberately do **not**
accept service-role tokens in the request body.

Step rows and final deliverables are persisted by the registered tools
themselves (`record_step`, `save_deliverable`); the endpoint just reports
the agent loop summary so Trigger.dev can log it and write the final
`tasks.status` / `tasks.cost_usd`.
"""

from __future__ import annotations

import logging
import os
import traceback
from typing import Any

from dotenv import load_dotenv

# Make the sibling ``seo/`` package importable when running from worker/.
# No-op in production (Docker copies seo/ next to main.py).
import path_setup  # noqa: F401  — side-effect import: edits sys.path.

# Load .env BEFORE importing modules that read env vars at import time.
load_dotenv()

from fastapi import FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from agent import AgentConfigError, run as run_agent
from steps import record_step, reset_step_counter

logger = logging.getLogger("worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))


# ---------------------------------------------------------------------------
# Shared-secret auth for /run
# ---------------------------------------------------------------------------
# The worker exposes a single sensitive endpoint (/run) that dispatches real
# Anthropic + DataForSEO calls. Without auth, anyone who can reach the worker
# URL can burn money and trigger arbitrary tasks. We require a shared secret
# header on every /run call. Trigger.dev sets it from its own env var.
#
# Production ALWAYS requires the secret. The only concession to local dev is:
# if WORKER_SHARED_SECRET is unset *and* SUPABASE_URL is also unset (i.e. we
# are clearly in dev / scratch mode), we permit the call but log a loud
# warning. In any production deployment, SUPABASE_URL is set, so the secret
# is mandatory.
import hmac as _hmac


def _require_worker_secret(provided: str | None) -> None:
    """Reject the request unless the provided header matches the env secret.

    Uses constant-time comparison so a timing oracle can't be used to
    discover the secret one byte at a time.
    """
    expected = os.environ.get("WORKER_SHARED_SECRET", "").strip()
    in_prod = bool(os.environ.get("SUPABASE_URL", "").strip())

    if not expected:
        if in_prod:
            # Misconfiguration: refuse to run with no auth in production.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Worker is misconfigured: WORKER_SHARED_SECRET is not set.",
            )
        # Dev mode without a secret — log a warning and let it through.
        logger.warning(
            "WORKER_SHARED_SECRET not set; /run is unauthenticated (dev mode only)."
        )
        return

    if not provided or not _hmac.compare_digest(provided, expected):
        # Don't echo the provided value or hint at length differences.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Worker-Secret header.",
        )

app = FastAPI(
    title="dataforseo-claude worker",
    version="0.1.0",
    description="Claude API agent loop that orchestrates DataForSEO scripts as tools.",
)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


VALID_TASK_TYPES = {
    "audit",
    "quick",
    "keywords",
    "technical",
    "backlinks",
    "rankings",
    "content_gap",
    "report_pdf",
}


class RunRequest(BaseModel):
    """Inbound payload for POST /run.

    The worker authenticates Supabase writes with its own
    ``SUPABASE_SERVICE_ROLE_KEY`` env var — we deliberately do NOT accept
    a service-role token in the request body. Doing so would put a
    plaintext god-key on every dispatch, and the receiver already has
    one. If we ever need per-task scoped tokens we'll add a different,
    more constrained field with a clear contract.
    """

    task_id: str = Field(..., min_length=1, description="Supabase tasks.id (uuid).")
    type: str = Field(..., description="Task type, e.g. 'audit' | 'quick' | 'keywords' | …")
    params: dict[str, Any] = Field(default_factory=dict, description="Task-specific parameters.")


class RunResponse(BaseModel):
    ok: bool
    task_id: str
    type: str
    iterations: int
    stop_reason: str | None
    cost_usd: float
    usage: dict[str, int]
    tool_calls: int
    duration_ms: int
    final_text: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
def health() -> dict[str, Any]:
    """Liveness probe. Always cheap; never touches Anthropic or Supabase."""
    return {
        "ok": True,
        "service": "dataforseo-claude-worker",
        "version": app.version,
        "anthropic_configured": bool(os.environ.get("ANTHROPIC_API_KEY")),
        "supabase_configured": bool(
            os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        ),
    }


@app.post("/run", response_model=RunResponse)
def run(
    req: RunRequest,
    x_worker_secret: str | None = Header(default=None, alias="X-Worker-Secret"),
) -> RunResponse:
    """Run a single task to completion. Synchronous — Trigger.dev handles retry/backoff.

    Auth:
      * Requires the ``X-Worker-Secret`` header to match
        ``WORKER_SHARED_SECRET`` (constant-time comparison).

    Errors:
      * 401 — bad / missing X-Worker-Secret.
      * 400 — unknown task type.
      * 503 — `ANTHROPIC_API_KEY` or `WORKER_SHARED_SECRET` missing.
      * 500 — anything else; the trace is logged server-side.
    """
    _require_worker_secret(x_worker_secret)

    if req.type not in VALID_TASK_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown task type '{req.type}'. Valid: {sorted(VALID_TASK_TYPES)}",
        )

    # The worker uses its own SUPABASE_SERVICE_ROLE_KEY env for Supabase writes.
    # No per-request override — see comment on RunRequest above.
    reset_step_counter(req.task_id)
    try:
        record_step(req.task_id, "Worker received task", "succeeded", {"type": req.type})
        result = run_agent(req.task_id, req.type, req.params)
        record_step(
            req.task_id,
            "Worker finished",
            "succeeded",
            {
                "iterations": result["iterations"],
                "stop_reason": result["stop_reason"],
                "cost_usd": result["cost_usd"],
                "tool_calls": result["tool_calls"],
            },
        )
    except AgentConfigError as exc:
        logger.warning("Agent config error for task %s: %s", req.task_id, exc)
        record_step(req.task_id, "Worker config error", "failed", {"error": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Task %s crashed", req.task_id)
        record_step(
            req.task_id,
            "Worker crashed",
            "failed",
            {"error": str(exc), "trace": traceback.format_exc(limit=10)},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Worker crashed: {exc}",
        ) from exc

    return RunResponse(
        ok=True,
        task_id=req.task_id,
        type=req.type,
        iterations=result["iterations"],
        stop_reason=result["stop_reason"],
        cost_usd=result["cost_usd"],
        usage=result["usage"],
        tool_calls=result["tool_calls"],
        duration_ms=result["duration_ms"],
        final_text=result["final_text"],
    )


# ---------------------------------------------------------------------------
# Generic error handler so unexpected errors return JSON, not HTML.
# ---------------------------------------------------------------------------


@app.exception_handler(Exception)
def _unhandled(_, exc: Exception) -> JSONResponse:  # type: ignore[override]
    logger.exception("Unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"ok": False, "error": str(exc) or exc.__class__.__name__},
    )
