"""FastAPI entry point for the SEO worker.

Exposes:
  * `GET  /health` — liveness probe used by Railway / Trigger.dev.
  * `POST /run`    — kicks off the Claude agent loop for a single task.

The web app dispatches one POST per task. The body carries everything
the worker needs: `task_id`, the `type` (audit / quick / keywords / …),
the params dict, and a Supabase service-role token the worker uses to
authenticate the writes back to Supabase.

Step rows and final deliverables are persisted by the registered tools
themselves (`record_step`, `save_deliverable`); the endpoint just reports
the agent loop summary so Trigger.dev can log it and write the final
`tasks.status` / `tasks.cost_usd`.
"""

from __future__ import annotations

import logging
import os
import traceback
from contextlib import contextmanager
from typing import Any

from dotenv import load_dotenv

# Make the sibling ``seo/`` package importable when running from worker/.
# No-op in production (Docker copies seo/ next to main.py).
import path_setup  # noqa: F401  — side-effect import: edits sys.path.

# Load .env BEFORE importing modules that read env vars at import time.
load_dotenv()

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from agent import AgentConfigError, run as run_agent
from steps import record_step, reset_step_counter

logger = logging.getLogger("worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

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
    """Inbound payload for POST /run."""

    task_id: str = Field(..., min_length=1, description="Supabase tasks.id (uuid).")
    type: str = Field(..., description="Task type, e.g. 'audit' | 'quick' | 'keywords' | …")
    params: dict[str, Any] = Field(default_factory=dict, description="Task-specific parameters.")
    supabase_service_token: str | None = Field(
        default=None,
        description=(
            "Supabase service-role JWT used by the worker to write step rows. "
            "Optional in dev — when absent, steps are written to a local JSONL file."
        ),
    )


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
def run(req: RunRequest) -> RunResponse:
    """Run a single task to completion. Synchronous — Trigger.dev handles retry/backoff.

    Errors:
      * 400 — unknown task type.
      * 503 — `ANTHROPIC_API_KEY` is missing on the worker.
      * 500 — anything else; the trace is logged server-side.
    """
    if req.type not in VALID_TASK_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown task type '{req.type}'. Valid: {sorted(VALID_TASK_TYPES)}",
        )

    # Allow the per-request token to override the worker-level service-role
    # key. Tokens scoped per-task are safer once we wire RLS bypass through
    # PostgREST. We restore the previous env on the way out.
    with _supabase_token_override(req.supabase_service_token):
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
# Internal helpers
# ---------------------------------------------------------------------------


@contextmanager
def _supabase_token_override(token: str | None):
    """Temporarily swap `SUPABASE_SERVICE_ROLE_KEY` if a per-task token is provided."""
    if not token:
        yield
        return
    previous = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    os.environ["SUPABASE_SERVICE_ROLE_KEY"] = token
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
        else:
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = previous


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
