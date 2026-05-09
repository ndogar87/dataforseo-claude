# dataforseo-claude worker

FastAPI service that runs the Claude API agent loop for one SEO task at a
time. Trigger.dev (or any caller) POSTs to `/run` with `{task_id, type,
params, supabase_service_token}`; the worker boots a Claude Opus 4.7
tool-use loop with the DataForSEO scripts registered as tools, streams
step rows back to Supabase via `record_step`, and persists the final
deliverables via `save_deliverable`.

## Status

Scaffold. The agent loop and tool registry are real. DataForSEO tool
executors are stubbed (returning realistic-looking dicts) until the
`seo/scripts/` refactor lands. Supabase persistence is real when
`SUPABASE_URL` is set; otherwise events are appended to
`worker/_dev_steps.jsonl` for local inspection.

## Layout

```
worker/
  main.py            FastAPI app: GET /health, POST /run
  agent.py           Claude messages.create tool-use loop (max 25 iterations,
                     cost tracking)
  tools.py           Tool definitions + executor functions (stubs for now)
  steps.py           record_step / save_deliverable (Supabase REST + dev JSONL
                     fallback)
  composite.py       Audit composite formula from seo/SKILL.md
  system_prompts.py  One Claude system prompt per task type
  pyproject.toml     Python 3.11+ deps
  Dockerfile         Production container
  railway.toml       Railway deploy config
  .env.example       Required environment variables
```

## Run locally (uv — recommended)

```bash
cd worker
uv sync
cp .env.example .env   # then fill in ANTHROPIC_API_KEY
uv run uvicorn main:app --reload
```

## Run locally (pip)

```bash
cd worker
python3 -m venv .venv && source .venv/bin/activate
pip install -e .
uvicorn main:app --reload
```

## Smoke tests

```bash
# Health probe — does not hit Anthropic
curl -s http://localhost:8000/health | jq

# Kick off a task. Without ANTHROPIC_API_KEY set this returns 503 with a
# clear message; with a key set it runs the real agent loop end-to-end.
curl -s -X POST http://localhost:8000/run \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "test-task-1",
    "type": "quick",
    "params": {"domain": "example.com"}
  }' | jq

# Inspect the dev-mode step log
tail -f _dev_steps.jsonl
```

## Environment

Required for production:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Drives the Claude tool-use loop. The worker returns 503 without it. |
| `WORKER_SHARED_SECRET` | Required. The worker rejects `POST /run` calls without a matching `X-Worker-Secret` header. The Trigger.dev task in `web/src/trigger/run-task.ts` must use the same value. Generate with `openssl rand -hex 32`. |
| `SUPABASE_URL` | Service-role REST base. When unset, steps fall back to the local JSONL log. |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role JWT for writes. The worker reads this from its own env — it is **not** accepted in the request body. |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | Used by the DataForSEO tool executors (currently stubbed; required once `seo/scripts/` ships its callable functions). |

Optional:

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_MODEL` | `claude-opus-4-7` | Override the model for the agent loop. |
| `LOG_LEVEL` | `INFO` | Standard logging level. |

## Deploy (Railway)

`railway.toml` is wired. Push the repo, point Railway at this directory,
and set the env vars above. The healthcheck path is `/health`.
