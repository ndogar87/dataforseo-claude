"""Claude API tool-use agent loop.

Boots an Anthropic `messages.create` loop with the worker's tools
registered. Each iteration:

  1. Send the running message history.
  2. If `stop_reason == "tool_use"`, execute every requested tool,
     append a `tool_result` content block per tool_use_id, loop.
  3. Otherwise return the final assistant message.

Token cost is accumulated across iterations using a simple per-model
price table and surfaced so the caller can write it to `tasks.cost_usd`.
The loop is capped at 25 iterations to prevent runaway spend.
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Any

from anthropic import Anthropic
from anthropic._exceptions import APIError

from system_prompts import get_system_prompt
from tools import execute_tool, get_tool_definitions

# Anthropic Opus 4.7 — the model called out in the project plan.
DEFAULT_MODEL = "claude-opus-4-7"
MAX_ITERATIONS = 25
DEFAULT_MAX_TOKENS = 4096

# Per-million-token prices (USD). Conservative estimates — update when
# Anthropic publishes Opus 4.7 pricing officially. Cache pricing is
# tracked separately because cache hits are ~10% of input cost.
MODEL_PRICING_PER_M_TOKENS: dict[str, dict[str, float]] = {
    "claude-opus-4-7": {
        "input": 15.0,
        "output": 75.0,
        "cache_write": 18.75,
        "cache_read": 1.50,
    },
    # Aliases / fallbacks
    "claude-opus-4-5": {"input": 15.0, "output": 75.0, "cache_write": 18.75, "cache_read": 1.50},
    "claude-sonnet-4-5": {"input": 3.0, "output": 15.0, "cache_write": 3.75, "cache_read": 0.30},
}


class AgentConfigError(RuntimeError):
    """Raised when the agent cannot start — typically a missing API key."""


@dataclass
class AgentResult:
    """Outcome of an agent loop run."""

    final_text: str
    iterations: int
    stop_reason: str | None
    cost_usd: float
    usage: dict[str, int] = field(default_factory=dict)
    tool_calls: int = 0


def _price_for(model: str) -> dict[str, float]:
    return MODEL_PRICING_PER_M_TOKENS.get(model, MODEL_PRICING_PER_M_TOKENS["claude-opus-4-7"])


def _accumulate_cost(usage_block: Any, model: str) -> tuple[float, dict[str, int]]:
    """Return (incremental_cost_usd, deltas_by_field) for one API response."""
    if usage_block is None:
        return 0.0, {}
    pricing = _price_for(model)

    input_tokens = getattr(usage_block, "input_tokens", 0) or 0
    output_tokens = getattr(usage_block, "output_tokens", 0) or 0
    cache_creation = getattr(usage_block, "cache_creation_input_tokens", 0) or 0
    cache_read = getattr(usage_block, "cache_read_input_tokens", 0) or 0

    cost = (
        input_tokens * pricing["input"]
        + output_tokens * pricing["output"]
        + cache_creation * pricing["cache_write"]
        + cache_read * pricing["cache_read"]
    ) / 1_000_000.0

    return cost, {
        "input_tokens": int(input_tokens),
        "output_tokens": int(output_tokens),
        "cache_creation_input_tokens": int(cache_creation),
        "cache_read_input_tokens": int(cache_read),
    }


def _content_block_to_dict(block: Any) -> dict[str, Any]:
    """Convert an Anthropic content block (object) into the dict form
    needed for the next assistant message round-trip."""
    btype = getattr(block, "type", None)
    if btype == "text":
        return {"type": "text", "text": getattr(block, "text", "")}
    if btype == "tool_use":
        return {
            "type": "tool_use",
            "id": getattr(block, "id", ""),
            "name": getattr(block, "name", ""),
            "input": getattr(block, "input", {}) or {},
        }
    # Defensive: forward unknown block types as-is (best-effort).
    if hasattr(block, "model_dump"):
        return block.model_dump()
    return {"type": btype or "unknown"}


def _extract_final_text(response: Any) -> str:
    parts: list[str] = []
    for block in getattr(response, "content", []) or []:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", "") or "")
    return "\n".join(p for p in parts if p).strip()


def run_agent(
    *,
    task_id: str,
    task_type: str,
    params: dict[str, Any],
    model: str | None = None,
    max_iterations: int = MAX_ITERATIONS,
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> AgentResult:
    """Run the Claude agent loop for one task.

    Raises :class:`AgentConfigError` if `ANTHROPIC_API_KEY` is missing —
    the FastAPI layer turns this into a 503.
    """
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise AgentConfigError(
            "ANTHROPIC_API_KEY is not set on the worker — the agent cannot start."
        )

    chosen_model = model or os.environ.get("CLAUDE_MODEL") or DEFAULT_MODEL
    system_prompt = get_system_prompt(task_type)
    tool_defs = get_tool_definitions()
    client = Anthropic(api_key=api_key)

    # Seed the conversation with the task brief.
    user_brief = json.dumps(
        {"task_id": task_id, "task_type": task_type, "params": params},
        default=str,
    )
    messages: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Run the task described below. Use the registered tools, "
                        "stream progress via `record_step`, and finish by saving the "
                        "appropriate deliverable(s).\n\n"
                        f"Task brief:\n```json\n{user_brief}\n```"
                    ),
                }
            ],
        }
    ]

    total_cost = 0.0
    usage_totals: dict[str, int] = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    tool_calls = 0
    last_stop_reason: str | None = None
    context = {"task_id": task_id}

    for iteration in range(1, max_iterations + 1):
        try:
            response = client.messages.create(
                model=chosen_model,
                max_tokens=max_tokens,
                system=system_prompt,
                tools=tool_defs,
                messages=messages,
            )
        except APIError as exc:
            # Surface as a failed terminal step the caller can persist.
            raise AgentConfigError(f"Anthropic API error on iteration {iteration}: {exc}") from exc

        last_stop_reason = getattr(response, "stop_reason", None)

        cost_inc, usage_inc = _accumulate_cost(getattr(response, "usage", None), chosen_model)
        total_cost += cost_inc
        for k, v in usage_inc.items():
            usage_totals[k] = usage_totals.get(k, 0) + v

        if last_stop_reason != "tool_use":
            return AgentResult(
                final_text=_extract_final_text(response),
                iterations=iteration,
                stop_reason=last_stop_reason,
                cost_usd=round(total_cost, 6),
                usage=usage_totals,
                tool_calls=tool_calls,
            )

        # Append the assistant's tool_use turn verbatim so the next request
        # has the same content blocks the API just produced.
        assistant_blocks = [_content_block_to_dict(b) for b in (response.content or [])]
        messages.append({"role": "assistant", "content": assistant_blocks})

        # Execute every tool_use block in this turn and assemble a single
        # user message containing all tool_result blocks.
        tool_result_blocks: list[dict[str, Any]] = []
        for block in response.content or []:
            if getattr(block, "type", None) != "tool_use":
                continue
            tool_calls += 1
            tool_name = getattr(block, "name", "")
            tool_input = getattr(block, "input", {}) or {}
            tool_use_id = getattr(block, "id", "")

            try:
                result = execute_tool(tool_name, tool_input, context)
                tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": json.dumps(result, default=str),
                    }
                )
            except Exception as exc:  # noqa: BLE001 — feed errors back to Claude
                tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "is_error": True,
                        "content": json.dumps({"error": str(exc)}),
                    }
                )

        if not tool_result_blocks:
            # Defensive: stop_reason was tool_use but no actual blocks. Bail.
            break

        messages.append({"role": "user", "content": tool_result_blocks})

    # Hit the iteration cap.
    return AgentResult(
        final_text="Agent loop hit max iterations without producing a final message.",
        iterations=max_iterations,
        stop_reason=last_stop_reason or "max_iterations",
        cost_usd=round(total_cost, 6),
        usage=usage_totals,
        tool_calls=tool_calls,
    )


# Convenience factory for dict-shape callers (FastAPI endpoint).
def run(task_id: str, task_type: str, params: dict[str, Any]) -> dict[str, Any]:
    started = time.time()
    result = run_agent(task_id=task_id, task_type=task_type, params=params)
    return {
        "final_text": result.final_text,
        "iterations": result.iterations,
        "stop_reason": result.stop_reason,
        "cost_usd": result.cost_usd,
        "usage": result.usage,
        "tool_calls": result.tool_calls,
        "duration_ms": int((time.time() - started) * 1000),
    }
