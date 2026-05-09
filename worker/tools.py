"""Claude tool registry for the SEO worker.

Each tool has:
  * `name` — what Claude sees and calls
  * `description` — short, action-oriented
  * `input_schema` — JSON schema for the tool parameters
  * `executor` — a Python callable that takes the tool input dict
    plus a `context` dict (currently `{"task_id": str}`) and returns
    a JSON-serialisable result that we hand back to Claude as a
    `tool_result` content block.

The 13 DataForSEO executors call into the importable functions in
``seo/scripts/`` (refactored from the original argparse-based CLI). Each
executor:

  * Lazily imports its ``cmd_<name>`` function so that a missing or
    broken ``seo`` package only fails at the time of first tool use,
    not at worker startup. This means ``/health`` and ``record_step``
    keep working even if the SEO library has an import-time problem.
  * Catches :class:`DataForSEOError` (HTTP / DataForSEO-side failures)
    and converts it into a structured ``{"ok": False, "error": ...,
    "tool": <name>}`` dict the LLM can read and react to. We deliberately
    do *not* catch ``Exception`` here — programming errors (TypeError,
    KeyError, …) should still bubble up to FastAPI's error handler.

The two infrastructure tools — ``record_step`` and ``save_deliverable``
— remain wired through to :mod:`steps`.
"""

from __future__ import annotations

import os
import re
import time
from typing import Any, Callable

# Side-effect import: makes ``from seo.scripts.* import ...`` work when
# this module is loaded from inside the ``worker/`` directory (local dev).
# In production (Docker), ``seo/`` already sits next to this file inside
# ``/app/`` so this is a no-op.
import path_setup  # noqa: F401

from steps import record_step as _record_step
from steps import save_deliverable as _save_deliverable

# Type alias for a tool executor.
ToolExecutor = Callable[[dict[str, Any], dict[str, Any]], Any]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seo_error_response(tool_name: str, exc: Exception) -> dict[str, Any]:
    """Convert a DataForSEOError (or similar) into an LLM-friendly result.

    The agent loop hands this dict back to Claude as the tool result, so
    Claude can see the failure mode and decide whether to retry, switch
    tools, or surface the error to the user via ``record_step``.
    """
    return {"ok": False, "error": str(exc), "tool": tool_name}


# ---------------------------------------------------------------------------
# DataForSEO executors — thin wrappers over seo.scripts.cmd_<name>
# ---------------------------------------------------------------------------
# Each executor:
#   1. Lazily imports the cmd_ function (keeps worker boot resilient).
#   2. Translates the Claude-facing argument names to the cmd_ kwargs.
#   3. Catches DataForSEOError and returns a structured failure dict.
# Successful results are returned as-is (the cmd_ functions already
# return JSON-serialisable dicts).


def _exec_keyword_volume(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.keyword_research import cmd_volume

    try:
        return cmd_volume(keywords=list(args.get("keywords") or []))
    except DataForSEOError as exc:
        return _seo_error_response("keyword_research_volume", exc)


def _exec_keyword_related(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.keyword_research import cmd_related

    try:
        # Tool schema uses ``seed``; the cmd_ parameter is named ``keyword``.
        return cmd_related(
            keyword=str(args.get("seed", "")),
            limit=int(args.get("limit", 200)),
        )
    except DataForSEOError as exc:
        return _seo_error_response("keyword_research_related", exc)


def _exec_keyword_suggestions(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.keyword_research import cmd_suggestions

    try:
        # Tool schema uses ``seed``; the cmd_ parameter is named ``keyword``.
        return cmd_suggestions(
            keyword=str(args.get("seed", "")),
            limit=int(args.get("limit", 100)),
        )
    except DataForSEOError as exc:
        return _seo_error_response("keyword_research_suggestions", exc)


def _exec_serp_rank(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.serp_check import cmd_rank

    try:
        return cmd_rank(
            domain=str(args.get("domain", "")),
            keywords=list(args.get("keywords") or []),
        )
    except DataForSEOError as exc:
        return _seo_error_response("serp_check_rank", exc)


def _exec_backlinks_summary(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.backlinks import cmd_summary
    from seo.scripts.dataforseo_client import DataForSEOError

    try:
        return cmd_summary(target=str(args.get("target", "")))
    except DataForSEOError as exc:
        return _seo_error_response("backlinks_summary", exc)


def _exec_backlinks_refdomains(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.backlinks import cmd_refdomains
    from seo.scripts.dataforseo_client import DataForSEOError

    try:
        return cmd_refdomains(
            target=str(args.get("target", "")),
            limit=int(args.get("limit", 50)),
        )
    except DataForSEOError as exc:
        return _seo_error_response("backlinks_refdomains", exc)


def _exec_backlinks_anchors(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.backlinks import cmd_anchors
    from seo.scripts.dataforseo_client import DataForSEOError

    try:
        return cmd_anchors(
            target=str(args.get("target", "")),
            limit=int(args.get("limit", 30)),
        )
    except DataForSEOError as exc:
        return _seo_error_response("backlinks_anchors", exc)


def _exec_on_page_site(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.on_page_audit import cmd_site

    try:
        # Long-running. cmd_site polls internally and returns the
        # aggregated summary once the crawl finishes.
        return cmd_site(
            target=str(args.get("target", "")),
            max_crawl_pages=int(args.get("max_crawl_pages", 100)),
        )
    except DataForSEOError as exc:
        return _seo_error_response("on_page_audit_site", exc)


def _exec_on_page_page(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.on_page_audit import cmd_page

    try:
        return cmd_page(url=str(args.get("url", "")))
    except DataForSEOError as exc:
        return _seo_error_response("on_page_audit_page", exc)


def _exec_domain_overview(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.domain_overview import cmd_overview

    try:
        return cmd_overview(target=str(args.get("target", "")))
    except DataForSEOError as exc:
        return _seo_error_response("domain_overview_overview", exc)


def _exec_domain_ranked(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.domain_overview import cmd_ranked

    try:
        return cmd_ranked(
            target=str(args.get("target", "")),
            limit=int(args.get("limit", 25)),
        )
    except DataForSEOError as exc:
        return _seo_error_response("domain_overview_ranked", exc)


def _exec_domain_competitors(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.domain_overview import cmd_competitors

    try:
        return cmd_competitors(
            target=str(args.get("target", "")),
            limit=int(args.get("limit", 20)),
        )
    except DataForSEOError as exc:
        return _seo_error_response("domain_overview_competitors", exc)


def _exec_domain_content_gap(args: dict[str, Any], _ctx: dict[str, Any]) -> Any:
    from seo.scripts.dataforseo_client import DataForSEOError
    from seo.scripts.domain_overview import cmd_content_gap

    try:
        # Tool schema accepts a single ``competitor`` string. The
        # underlying cmd_ takes a list so the same function can serve
        # multi-competitor gap reports later. Wrap into a list here.
        return cmd_content_gap(
            you=str(args.get("you", "")),
            competitors=[str(args.get("competitor", ""))],
        )
    except DataForSEOError as exc:
        return _seo_error_response("domain_overview_content_gap", exc)


# ---------------------------------------------------------------------------
# Infrastructure tool executors (real, not stubbed)
# ---------------------------------------------------------------------------


# Defense-in-depth caps so a prompt-injection that tricks Claude into
# stuffing secrets through `record_step` can't actually exfiltrate much.
# These bound size, depth, and explicitly redact env-vars + token shapes.
_RECORD_STEP_LABEL_MAX = 200
_RECORD_STEP_PAYLOAD_MAX_BYTES = 8 * 1024  # 8 KB total per step
_RECORD_STEP_STRING_MAX = 1000             # 1 KB per leaf string
_RECORD_STEP_MAX_DEPTH = 4
_REDACTED = "[redacted]"

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


def _scrub_string(s: str) -> str:
    """Truncate + redact secret-looking substrings inside a string."""
    if len(s) > _RECORD_STEP_STRING_MAX:
        s = s[:_RECORD_STEP_STRING_MAX] + "…"
    for pat in _SECRET_PATTERNS:
        s = pat.sub(_REDACTED, s)
    return s


def _scrub_value(value: Any, depth: int = 0) -> Any:
    """Recursively scrub a payload value: depth-bounded, secret-aware."""
    if depth >= _RECORD_STEP_MAX_DEPTH:
        return _REDACTED + " (depth)"
    if isinstance(value, str):
        return _scrub_string(value)
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for k, v in value.items():
            key = str(k)
            if key.lower() in _SENSITIVE_FIELD_NAMES:
                out[key] = _REDACTED
            else:
                out[key] = _scrub_value(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        # Bound list length too.
        capped = list(value)[:50]
        return [_scrub_value(v, depth + 1) for v in capped]
    # Fall back: stringify, then scrub.
    return _scrub_string(str(value))


def _scrub_payload_for_step(payload: Any) -> Any:
    """Apply secret redaction + size caps to a payload before it lands in
    `task_steps`. Also redacts any value whose substring matches a known
    env-var secret (so even a clever encoding gets caught).
    """
    if payload is None:
        return {}

    scrubbed = _scrub_value(payload)

    # Last line of defense: replace any literal env-var secret value that
    # somehow survived structural scrubbing. We compare against the raw
    # values of variables we know are sensitive.
    env_secrets: list[str] = []
    for env_name in (
        "WORKER_SHARED_SECRET",
        "SUPABASE_SERVICE_ROLE_KEY",
        "ANTHROPIC_API_KEY",
        "DATAFORSEO_PASSWORD",
        "RESEND_API_KEY",
    ):
        v = os.environ.get(env_name, "").strip()
        # Skip very short values to avoid spurious replacements.
        if v and len(v) >= 12:
            env_secrets.append(v)

    def _replace_env_secrets(obj: Any) -> Any:
        if isinstance(obj, str):
            out = obj
            for sec in env_secrets:
                if sec in out:
                    out = out.replace(sec, _REDACTED)
            return out
        if isinstance(obj, dict):
            return {k: _replace_env_secrets(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_replace_env_secrets(v) for v in obj]
        return obj

    scrubbed = _replace_env_secrets(scrubbed)

    # Hard byte cap — if it's still too big, JSON-truncate.
    import json as _json

    try:
        encoded = _json.dumps(scrubbed, default=str)
        if len(encoded.encode("utf-8")) > _RECORD_STEP_PAYLOAD_MAX_BYTES:
            return {
                "_truncated": True,
                "summary": _scrub_string(encoded)[:1000] + "…",
            }
    except Exception:  # noqa: BLE001
        return {"_truncated": True, "summary": "<unserialisable payload>"}

    return scrubbed


def _exec_record_step(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    task_id = ctx["task_id"]
    label = str(args.get("label", "step")).strip() or "step"
    if len(label) > _RECORD_STEP_LABEL_MAX:
        label = label[:_RECORD_STEP_LABEL_MAX] + "…"
    status = str(args.get("status", "running"))
    payload = _scrub_payload_for_step(args.get("payload"))
    row = _record_step(task_id, label, status, payload)
    return {"ok": True, "step": {k: row.get(k) for k in ("idx", "label", "status")}}


def _exec_save_deliverable(args: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any]:
    task_id = ctx["task_id"]
    kind = str(args.get("kind", "json_audit"))
    content = args.get("content")
    row = _save_deliverable(task_id, kind, content)
    return {
        "ok": True,
        "deliverable": {
            "id": row.get("id"),
            "kind": row.get("kind"),
            "storage_path": row.get("storage_path"),
            "share_url": row.get("share_url"),
        },
    }


# ---------------------------------------------------------------------------
# Tool registry — what we expose to Claude
# ---------------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "keyword_research_volume",
        "description": "Pull search volume, CPC, and competition for a list of exact keywords (DataForSEO Keywords Data google_ads/search_volume).",
        "input_schema": {
            "type": "object",
            "properties": {
                "keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Exact keywords to look up. Up to 1000 per call.",
                },
            },
            "required": ["keywords"],
        },
        "executor": _exec_keyword_volume,
    },
    {
        "name": "keyword_research_related",
        "description": "Find related keywords for a seed term with metrics (DataForSEO Labs related_keywords).",
        "input_schema": {
            "type": "object",
            "properties": {
                "seed": {"type": "string", "description": "Seed keyword."},
                "limit": {"type": "integer", "default": 200, "minimum": 1, "maximum": 1000},
            },
            "required": ["seed"],
        },
        "executor": _exec_keyword_related,
    },
    {
        "name": "keyword_research_suggestions",
        "description": "Get long-tail keyword suggestions for a seed term (DataForSEO Labs keyword_suggestions).",
        "input_schema": {
            "type": "object",
            "properties": {
                "seed": {"type": "string"},
                "limit": {"type": "integer", "default": 100, "minimum": 1, "maximum": 1000},
            },
            "required": ["seed"],
        },
        "executor": _exec_keyword_suggestions,
    },
    {
        "name": "serp_check_rank",
        "description": "Live Google organic position for a domain across multiple keywords (DataForSEO SERP google/organic/live).",
        "input_schema": {
            "type": "object",
            "properties": {
                "domain": {"type": "string"},
                "keywords": {"type": "array", "items": {"type": "string"}, "minItems": 1},
            },
            "required": ["domain", "keywords"],
        },
        "executor": _exec_serp_rank,
    },
    {
        "name": "backlinks_summary",
        "description": "High-level backlink profile metrics for a target domain (DataForSEO Backlinks summary).",
        "input_schema": {
            "type": "object",
            "properties": {"target": {"type": "string"}},
            "required": ["target"],
        },
        "executor": _exec_backlinks_summary,
    },
    {
        "name": "backlinks_refdomains",
        "description": "Top referring domains for a target (DataForSEO Backlinks referring_domains).",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 1000},
            },
            "required": ["target"],
        },
        "executor": _exec_backlinks_refdomains,
    },
    {
        "name": "backlinks_anchors",
        "description": "Top anchor texts pointing at a target (DataForSEO Backlinks anchors).",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "limit": {"type": "integer", "default": 30, "minimum": 1, "maximum": 1000},
            },
            "required": ["target"],
        },
        "executor": _exec_backlinks_anchors,
    },
    {
        "name": "on_page_audit_site",
        "description": "Run a full-site On-Page crawl and return aggregated issues. Long-running (2-5 min for 100 pages).",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "max_crawl_pages": {"type": "integer", "default": 100, "minimum": 1, "maximum": 1000},
            },
            "required": ["target"],
        },
        "executor": _exec_on_page_site,
    },
    {
        "name": "on_page_audit_page",
        "description": "Run a single-page On-Page check (fast, synchronous).",
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
        "executor": _exec_on_page_page,
    },
    {
        "name": "domain_overview_overview",
        "description": "DataForSEO Labs domain_rank_overview — traffic, keyword count, domain rank.",
        "input_schema": {
            "type": "object",
            "properties": {"target": {"type": "string"}},
            "required": ["target"],
        },
        "executor": _exec_domain_overview,
    },
    {
        "name": "domain_overview_ranked",
        "description": "Keywords a domain ranks for, sorted by traffic (DataForSEO Labs ranked_keywords).",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "limit": {"type": "integer", "default": 25, "minimum": 1, "maximum": 1000},
            },
            "required": ["target"],
        },
        "executor": _exec_domain_ranked,
    },
    {
        "name": "domain_overview_competitors",
        "description": "Top SEO competitors for a domain (DataForSEO Labs competitors_domain).",
        "input_schema": {
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "limit": {"type": "integer", "default": 20, "minimum": 1, "maximum": 1000},
            },
            "required": ["target"],
        },
        "executor": _exec_domain_competitors,
    },
    {
        "name": "domain_overview_content_gap",
        "description": "Keywords a competitor ranks for that you don't (DataForSEO Labs domain_intersection).",
        "input_schema": {
            "type": "object",
            "properties": {
                "you": {"type": "string"},
                "competitor": {"type": "string"},
            },
            "required": ["you", "competitor"],
        },
        "executor": _exec_domain_content_gap,
    },
    {
        "name": "record_step",
        "description": (
            "Record a step on the live task timeline. Call before each major action with status='running' "
            "and again after with status='succeeded' or 'failed'. Payload is a small JSON-serialisable summary."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "label": {"type": "string", "description": "Short human-readable label for the timeline."},
                "status": {"type": "string", "enum": ["running", "succeeded", "failed"]},
                "payload": {"type": "object", "description": "Small summary blob.", "additionalProperties": True},
            },
            "required": ["label", "status"],
        },
        "executor": _exec_record_step,
    },
    {
        "name": "save_deliverable",
        "description": (
            "Persist a final deliverable for this task and return a share URL. "
            "Allowed kinds: pdf_report, json_audit, csv_keywords, markdown_summary."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["pdf_report", "json_audit", "csv_keywords", "markdown_summary"],
                },
                "content": {
                    "description": "Deliverable body. JSON object/array for json_audit, string for the others.",
                },
            },
            "required": ["kind", "content"],
        },
        "executor": _exec_save_deliverable,
    },
]


# Public helpers -------------------------------------------------------------


def get_tool_definitions() -> list[dict[str, Any]]:
    """Return the tool list in the format Claude expects (no executors)."""
    return [
        {
            "name": t["name"],
            "description": t["description"],
            "input_schema": t["input_schema"],
        }
        for t in TOOLS
    ]


def execute_tool(name: str, args: dict[str, Any], context: dict[str, Any]) -> Any:
    """Look up and run an executor. Raises KeyError if the tool is unknown."""
    for tool in TOOLS:
        if tool["name"] == name:
            executor: ToolExecutor = tool["executor"]
            started = time.time()
            result = executor(args or {}, context)
            # Lightweight execution metadata so the agent loop can log it if needed.
            if isinstance(result, dict):
                result.setdefault("_meta", {})["duration_ms"] = int((time.time() - started) * 1000)
            return result
    raise KeyError(f"Unknown tool: {name}")
