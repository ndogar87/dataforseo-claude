"""Persistence helpers for task progress and final deliverables.

In production the worker writes to Supabase using a service-role key.
For local development (when `SUPABASE_URL` is empty) we append every
event to `worker/_dev_steps.jsonl` so the agent loop is testable
without standing up Supabase.

The two public entry points are :func:`record_step` and
:func:`save_deliverable`. They are called by the registered Claude
tools in :mod:`tools`, but they are also safe to call directly.
"""

from __future__ import annotations

import base64
import json
import os
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

# Directory containing this module; we use it for the dev-mode log location.
_HERE = Path(__file__).resolve().parent
_DEV_LOG = _HERE / "_dev_steps.jsonl"

# A simple per-task step-index counter. The Supabase schema has a
# (task_id, idx) ordering on `task_steps`; we generate idx ourselves
# so the agent loop doesn't have to.
_STEP_LOCK = threading.Lock()
_STEP_COUNTERS: dict[str, int] = {}


def _next_step_idx(task_id: str) -> int:
    with _STEP_LOCK:
        idx = _STEP_COUNTERS.get(task_id, 0)
        _STEP_COUNTERS[task_id] = idx + 1
        return idx


def _supabase_configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL")) and bool(
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    )


def _dev_append(event: dict[str, Any]) -> None:
    """Append an event to the local dev log. Best-effort, non-blocking-ish."""
    try:
        _DEV_LOG.parent.mkdir(parents=True, exist_ok=True)
        with _DEV_LOG.open("a", encoding="utf-8") as fp:
            fp.write(json.dumps(event, default=str) + "\n")
    except OSError:
        # Dev logging must never crash a real run.
        pass


def _supabase_insert(table: str, row: dict[str, Any]) -> dict[str, Any]:
    """POST a single row to Supabase REST. Returns the inserted row."""
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{base}/rest/v1/{table}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=row)
        resp.raise_for_status()
        data = resp.json()
        return data[0] if isinstance(data, list) and data else (data or {})


def _supabase_storage_upload(bucket: str, path: str, body: bytes, content_type: str) -> str:
    """Upload bytes to Supabase Storage. Returns the storage path on success."""
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    url = f"{base}/storage/v1/object/{bucket}/{path}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(url, headers=headers, content=body)
        resp.raise_for_status()
    return f"{bucket}/{path}"


def record_step(
    task_id: str,
    label: str,
    status: str,
    payload: Any | None = None,
    *,
    idx: int | None = None,
) -> dict[str, Any]:
    """Insert a `task_steps` row.

    Returns the row that was persisted. In dev mode the row is appended
    to `worker/_dev_steps.jsonl`.
    """
    if status not in {"running", "succeeded", "failed"}:
        # Don't reject; just normalise so we never write garbage.
        status = "running" if status not in {"queued", "cancelled"} else status

    if idx is None:
        idx = _next_step_idx(task_id)

    now = time.time()
    row: dict[str, Any] = {
        "task_id": task_id,
        "idx": idx,
        "label": label,
        "status": status,
        "payload_json": payload if payload is not None else {},
        # Supabase columns are timestamps; the REST API accepts ISO strings.
        # We send epoch-derived ISO so dev logs stay readable.
        "started_at": _iso(now),
        "finished_at": _iso(now) if status in {"succeeded", "failed"} else None,
    }

    if _supabase_configured():
        try:
            return _supabase_insert("task_steps", row)
        except Exception as exc:  # noqa: BLE001 — surface as failed step in dev log
            _dev_append({"_error": "supabase_insert_failed", "table": "task_steps", "row": row, "exc": str(exc)})
            return row
    else:
        _dev_append({"event": "task_step", **row})
        return row


def save_deliverable(
    task_id: str,
    kind: str,
    content: Any,
    *,
    filename: str | None = None,
) -> dict[str, Any]:
    """Persist a final deliverable for a task.

    `kind` ∈ {"pdf_report", "json_audit", "csv_keywords", "markdown_summary"}.
    `content` is either a string, a dict (which we JSON-encode), or raw bytes.

    In production: uploads to Supabase Storage bucket `deliverables` and
    inserts a row in the `deliverables` table. Returns the row plus a
    `share_url` stub built from the public token.

    In dev: appends the deliverable to the JSONL log (with bytes
    base64-encoded) and returns a synthetic row.
    """
    body, content_type, ext = _encode_content(kind, content)
    public_token = secrets.token_urlsafe(24)
    deliverable_id = str(uuid.uuid4())
    safe_filename = filename or f"{kind}-{deliverable_id}.{ext}"
    storage_path = f"{task_id}/{safe_filename}"

    row: dict[str, Any] = {
        "id": deliverable_id,
        "task_id": task_id,
        "kind": kind,
        "storage_path": f"deliverables/{storage_path}",
        "public_token": public_token,
        "expires_at": _iso(time.time() + 30 * 24 * 3600),
    }

    if _supabase_configured():
        try:
            _supabase_storage_upload("deliverables", storage_path, body, content_type)
            inserted = _supabase_insert("deliverables", row)
            inserted["share_url"] = f"/share/{public_token}"
            return inserted
        except Exception as exc:  # noqa: BLE001
            _dev_append(
                {
                    "_error": "supabase_deliverable_failed",
                    "row": row,
                    "exc": str(exc),
                }
            )
            row["share_url"] = f"/share/{public_token}"
            return row
    else:
        _dev_append(
            {
                "event": "deliverable",
                **row,
                "content_type": content_type,
                "size_bytes": len(body),
                # Encode raw bytes so the JSONL line is valid UTF-8.
                "content_b64": base64.b64encode(body).decode("ascii"),
            }
        )
        row["share_url"] = f"/share/{public_token}"
        return row


def reset_step_counter(task_id: str) -> None:
    """Reset the in-memory step counter for a task. Call at run start."""
    with _STEP_LOCK:
        _STEP_COUNTERS.pop(task_id, None)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _iso(epoch: float) -> str:
    # ISO 8601 UTC with seconds precision.
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _encode_content(kind: str, content: Any) -> tuple[bytes, str, str]:
    """Return (bytes, content_type, file_extension) for a deliverable payload."""
    if isinstance(content, (bytes, bytearray)):
        if kind == "pdf_report":
            return bytes(content), "application/pdf", "pdf"
        return bytes(content), "application/octet-stream", "bin"

    if kind == "json_audit" or isinstance(content, (dict, list)):
        body = json.dumps(content, indent=2, default=str).encode("utf-8")
        return body, "application/json", "json"

    if kind == "csv_keywords":
        return str(content).encode("utf-8"), "text/csv", "csv"

    if kind == "markdown_summary":
        return str(content).encode("utf-8"), "text/markdown", "md"

    if kind == "pdf_report":
        # Caller passed a string; treat as base64 if it looks like base64,
        # otherwise utf-8 encode (keeps tests honest while real PDF bytes
        # come through the bytes path above).
        try:
            return base64.b64decode(content, validate=True), "application/pdf", "pdf"
        except Exception:  # noqa: BLE001
            return str(content).encode("utf-8"), "application/pdf", "pdf"

    return str(content).encode("utf-8"), "text/plain", "txt"
