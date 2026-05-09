"""Payload scrubbing for `record_step`.

The agent loop hands us arbitrary tool inputs which Claude can theoretically
be tricked (via prompt injection in a tool result, e.g. a SERP title) into
constructing. To make sure a stray instruction never exfiltrates secrets
through the live timeline, every payload that flows into `task_steps`
goes through :func:`scrub_payload` first.

Defense in depth, in three layers:

  1. Structural scrubbing — recursively bound depth + per-string length,
     redact values whose key looks like a secret-bearing field name.
  2. Pattern scrubbing — redact substrings inside any string value that
     match common secret shapes (JWT, ``sk-…``, hex, base64, ``Bearer``).
  3. Env-secret replacement — last-mile pass that replaces literal env-var
     values (``ANTHROPIC_API_KEY`` etc.) wherever they survived (1) and (2).

A final byte cap is applied; oversized payloads are summarised rather than
dropped so the UI still surfaces *something*.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

# Public knobs — referenced by tests + tools.py.
RECORD_STEP_LABEL_MAX = 200
RECORD_STEP_PAYLOAD_MAX_BYTES = 8 * 1024  # 8 KB total per step
RECORD_STEP_STRING_MAX = 1000             # 1 KB per leaf string
RECORD_STEP_MAX_DEPTH = 4
REDACTED = "[redacted]"

# Heuristics for things that look like secrets. Conservative — we want
# to redact rather than leak. Patterns:
#   - JWT-shaped: 3 dot-separated base64url segments (~30+ chars total).
#   - sk-* / sb-* / supa-* / Bearer * tokens.
#   - Long hex / base64-ish strings that look more like keys than text.
_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\beyJ[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\.[A-Za-z0-9_\-]{6,}\b"),
    re.compile(r"\b(sk|sb|sbp|rk|pk|service_role)[-_][A-Za-z0-9_-]{16,}\b", re.I),
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{16,}\b", re.I),
    re.compile(r"\b[A-Fa-f0-9]{40,}\b"),
    re.compile(r"\b[A-Za-z0-9+/]{40,}={0,2}\b"),
)

# Field names whose values we always redact.
_SENSITIVE_FIELD_NAMES = {
    "anthropic_api_key",
    "supabase_service_role_key",
    "supabase_service_token",
    "service_role",
    "service_token",
    "api_key",
    "apikey",
    "auth",
    "authorization",
    "password",
    "secret",
    "session",
    "cookie",
    "jwt",
    "token",
    "x-worker-secret",
    "worker_shared_secret",
}

# Env vars whose literal values we replace as a last-mile pass.
_ENV_SECRET_NAMES: tuple[str, ...] = (
    "WORKER_SHARED_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "DATAFORSEO_PASSWORD",
    "RESEND_API_KEY",
)


def _scrub_string(s: str) -> str:
    """Truncate + redact secret-looking substrings inside a string."""
    if len(s) > RECORD_STEP_STRING_MAX:
        s = s[:RECORD_STEP_STRING_MAX] + "…"
    for pat in _SECRET_PATTERNS:
        s = pat.sub(REDACTED, s)
    return s


def _scrub_value(value: Any, depth: int = 0) -> Any:
    """Recursively scrub a payload value: depth-bounded, secret-aware."""
    if depth >= RECORD_STEP_MAX_DEPTH:
        return REDACTED + " (depth)"
    if isinstance(value, str):
        return _scrub_string(value)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            if key.lower() in _SENSITIVE_FIELD_NAMES:
                out[key] = REDACTED
            else:
                out[key] = _scrub_value(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        # Bound list length too.
        capped = list(value)[:50]
        return [_scrub_value(v, depth + 1) for v in capped]
    # Fall back: stringify, then scrub.
    return _scrub_string(str(value))


def _replace_env_secrets(obj: Any, env_secrets: list[str]) -> Any:
    if isinstance(obj, str):
        out = obj
        for sec in env_secrets:
            if sec in out:
                out = out.replace(sec, REDACTED)
        return out
    if isinstance(obj, dict):
        return {k: _replace_env_secrets(v, env_secrets) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_replace_env_secrets(v, env_secrets) for v in obj]
    return obj


def scrub_payload(payload: Any) -> Any:
    """Apply secret redaction + size caps to a payload before it lands in
    `task_steps`. Returns a JSON-serialisable structure suitable for the
    `payload_json` column.
    """
    if payload is None:
        return {}

    scrubbed = _scrub_value(payload)

    # Last line of defense: replace any literal env-var secret value that
    # somehow survived structural scrubbing.
    env_secrets: list[str] = []
    for env_name in _ENV_SECRET_NAMES:
        v = os.environ.get(env_name, "").strip()
        # Skip very short values to avoid spurious replacements.
        if v and len(v) >= 12:
            env_secrets.append(v)
    if env_secrets:
        scrubbed = _replace_env_secrets(scrubbed, env_secrets)

    # Hard byte cap — if it's still too big, JSON-truncate.
    try:
        encoded = json.dumps(scrubbed, default=str)
        if len(encoded.encode("utf-8")) > RECORD_STEP_PAYLOAD_MAX_BYTES:
            return {
                "_truncated": True,
                "summary": _scrub_string(encoded)[:1000] + "…",
            }
    except Exception:  # noqa: BLE001
        return {"_truncated": True, "summary": "<unserialisable payload>"}

    return scrubbed


def truncate_label(label: str) -> str:
    """Cap an arbitrary label string to a sensible UI length."""
    if len(label) > RECORD_STEP_LABEL_MAX:
        return label[:RECORD_STEP_LABEL_MAX] + "…"
    return label
