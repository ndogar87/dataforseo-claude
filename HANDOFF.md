# Handoff — dataforseo-claude webapp

A handoff snapshot for starting a fresh Claude Code conversation on this project.
Last updated: 2026-05-10.

---

## What this is

A multi-tenant SEO platform built around the `dataforseo-claude` skill pack. Phase 1 ships staff-only — the agency's team logs in, manages client projects, runs SEO tasks (audits, keyword research, etc.), and shares deliverables with clients. Phase 2 will open paid client signup.

The full plan lives at `plan.md` in the repo root. Read that first.

## Architecture (one repo, three deployable units)

| Unit | Path | Stack | Purpose |
|---|---|---|---|
| Web app | `web/` | Next.js 15 App Router, Tailwind, shadcn/ui, Supabase, Trigger.dev SDK, Resend | Staff dashboard + public share pages |
| Worker | `worker/` | FastAPI, Anthropic SDK (Opus 4.7), supabase-py | Claude tool-use agent loop. Wraps the SEO Python library as 13 tools. Long-running. |
| SEO library | `seo/scripts/` | Python | DataForSEO API client + `cmd_*` callable functions (also still works as CLI from the original skill pack) |

**Data layer:** Supabase Postgres + Auth (email+password) + Storage (deliverables bucket) + Realtime (live timeline).

**Job queue:** Trigger.dev. The web Server Action inserts a `tasks` row → fires the `run-task` Trigger.dev task → which POSTs to the worker's `/run` endpoint. Trigger.dev handles retries (with idempotency guard).

**Email:** Resend (free tier; sender domain needs verification per project).

## Repo layout

```
dataforseo-claude/
├─ plan.md                            architectural plan
├─ HANDOFF.md                         this file
├─ web/                               Next.js app (deploy to Vercel)
│  ├─ app/(staff)/projects/           staff dashboard routes
│  ├─ app/share/[token]/              public read-only report viewer
│  ├─ app/login/                      email+password sign-in
│  ├─ src/trigger/run-task.ts         Trigger.dev task definition
│  ├─ lib/                            supabase clients, share helpers, types
│  ├─ db/migrations/                  0001_init / 0002_security / 0003_qa_hardening
│  ├─ db/policies.sql                 canonical RLS reference (mirrors migrations)
│  ├─ db/seed.sql                     creates the 'agency' workspace
│  ├─ middleware.ts                   share rate limit + security headers
│  └─ trigger.config.ts               Trigger.dev config
├─ worker/                            FastAPI worker (deploy to Railway/Fly)
│  ├─ main.py                         POST /run + /health
│  ├─ agent.py                        Claude tool-use loop, AgentRunError on cap
│  ├─ tools.py                        13 DataForSEO tools + record_step + save_deliverable
│  ├─ scrub.py                        record_step payload secret-scrubbing
│  ├─ system_prompts.py               per-task-type Claude system prompts
│  ├─ steps.py                        Supabase REST writes (steps + deliverables)
│  ├─ composite.py                    audit weighted-score formula
│  ├─ path_setup.py                   sys.path tweak so `seo` is importable
│  └─ Dockerfile                      build context = repo root
└─ seo/                               original skill pack — left untouched (CLI still works)
   └─ scripts/                        each script exports cmd_<sub>(**kw) functions
```

## Last commits on `main`

```
7ed83db  QA pass: agent error paths, idempotency, last-owner guard, polish
540d32b  Cleanup pass + fix .gitignore that was silently excluding web/lib/
7d228cf  Security pass: worker auth, prompt-injection hardening, share path lockdown
363867d  Build webapp + worker around the SEO skill pack
```

`git push origin main` is up to date with the remote.

## Environment variables — where each one lives

| Var | File | Purpose |
|---|---|---|
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | root `.env` *and* `worker/.env` | Login email + API password (long alphanumeric, NOT the dashboard password) |
| `NEXT_PUBLIC_SUPABASE_URL` | `web/.env`, `worker/.env` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `web/.env` | Anon key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | `web/.env`, `worker/.env` | Service role (server-only). **Rotate this** — it was previously in worker request bodies. |
| `ANTHROPIC_API_KEY` | `worker/.env` | Claude API |
| `RESEND_API_KEY` | `web/.env` | Email send |
| `RESEND_FROM` | `web/.env` (optional) | Verified sender, e.g. `reports@yourdomain.com`. Defaults to a placeholder that will fail. |
| `TRIGGER_SECRET_KEY` | `web/.env` | Trigger.dev (use the dev token `tr_dev_*` for local) |
| `TRIGGER_PROJECT_REF` | `web/.env` | `proj_zbdpgupqcjhappyvxncj` |
| `WORKER_URL` | `web/.env` | `http://localhost:8000` for dev; deployed Railway/Fly URL for prod |
| `WORKER_SHARED_SECRET` | `web/.env`, `worker/.env` | Shared HMAC secret. **Generate with `openssl rand -hex 32`**. Worker refuses unauth `/run` in prod when `SUPABASE_URL` is set. |
| `NEXT_PUBLIC_APP_URL` | `web/.env` | Used to build share URLs. Optional; falls back to `http://localhost:3000`. |

`.env.example` files in each directory document all of these with notes.

## How to run locally (4 terminal windows on Windows)

```powershell
# Window 1 — Trigger.dev local dev server
cd C:\Users\nadir\Documents\github\dataforseo-claude\web
pnpm trigger:dev

# Window 2 — FastAPI worker
cd C:\Users\nadir\Documents\github\dataforseo-claude\worker
.\.venv\Scripts\python.exe -m uvicorn main:app --reload

# Window 3 — Next.js dev
cd C:\Users\nadir\Documents\github\dataforseo-claude\web
pnpm dev

# Window 4 — git / general shell
```

Open <http://localhost:3000> and sign in.

### One-time bootstrap on a fresh Supabase project

1. Run `web/db/migrations/0001_init.sql` in SQL Editor.
2. Run `web/db/policies.sql` in SQL Editor.
3. Run `web/db/seed.sql` in SQL Editor (creates the `agency` workspace).
4. Apply security + QA migrations:
   - `web/db/migrations/0002_security.sql`
   - `web/db/migrations/0003_qa_hardening.sql`
5. Enable Realtime on the timeline tables:
   ```sql
   alter publication supabase_realtime add table public.tasks;
   alter publication supabase_realtime add table public.task_steps;
   alter publication supabase_realtime add table public.deliverables;
   ```
6. Storage → New bucket → name `deliverables`, public off.
7. Auth → Users → Create user with email + password (or invite). Toggle "Auto Confirm User" on.
8. Tie that user to the agency workspace as owner:
   ```sql
   insert into workspace_members (workspace_id, user_id, role) values
     ((select id from workspaces where slug = 'agency'),
      (select id from auth.users where email = 'YOU@yourdomain.com'),
      'owner');
   ```

## Critical action items still pending

1. **Apply the security + QA migrations** if you haven't yet — see #4 above. SQL block was provided in the chat that wrote this file; the source files are `web/db/migrations/0002_security.sql` and `0003_qa_hardening.sql`.
2. **Generate `WORKER_SHARED_SECRET`** (`openssl rand -hex 32`). Set the same value in (a) `worker/.env`, (b) Trigger.dev project env, (c) the worker's deployed env (Railway/Fly). Without it, the worker rejects `/run` in prod.
3. **Rotate the Supabase service-role key.** Earlier dispatches transmitted it in plaintext request bodies between Trigger.dev and the worker. Treat it as compromised. Generate a new one in Supabase → Settings → API → Reset, update `web/.env` + `worker/.env` + Trigger.dev env + Vercel env, then revoke the old one.
4. **Verify a Resend sender domain** — or set `RESEND_FROM` to `onboarding@resend.dev` for testing. The default `reports@yourseoagency.com` is a placeholder that will be rejected.

## Phase 2 follow-ups (intentional gaps, all documented in code)

| Concern | Where | Recommended fix |
|---|---|---|
| `(staff)/layout.tsx` has no auth-redirect guard | `web/app/(staff)/layout.tsx` | Add `if (!user) redirect('/login')` |
| `middleware.ts` doesn't refresh Supabase session cookies | `web/middleware.ts` | Add `updateSession()` from `@supabase/ssr` docs |
| `shareDeliverable` recipient email unrestricted | `web/app/(staff)/projects/[id]/tasks/[taskId]/actions.ts` | Allow-list per workspace; rate limit per staff user |
| Share rate-limit is in-memory | `web/middleware.ts` | Move to Upstash Redis once on multi-region |
| `workspace-context.tsx` ships a stub workspace | `web/lib/workspace-context.tsx` | Plumb real workspace via Server Component prop |
| CSP uses `'unsafe-inline'` / `'unsafe-eval'` | `web/middleware.ts` | Per-request nonce strategy |
| "New project" assumes user is in ≥1 workspace | `web/app/(staff)/projects/actions.ts` | Bootstrap-workspace flow on first login |

## Worker tool inventory (all live, no stubs)

`worker/tools.py` registers 15 Claude tools:

- 13 DataForSEO wrappers — `keyword_research_volume`, `keyword_research_related`, `keyword_research_suggestions`, `serp_check_rank`, `backlinks_summary`, `backlinks_refdomains`, `backlinks_anchors`, `on_page_audit_site`, `on_page_audit_page`, `domain_overview_overview`, `domain_overview_ranked`, `domain_overview_competitors`, `domain_overview_content_gap`. Each lazily imports its `cmd_*` from `seo.scripts.*`.
- `record_step(label, status, payload)` — INSERTs `task_steps` (payload is scrubbed for secrets via `worker/scrub.py`).
- `save_deliverable(kind, content)` — uploads to Storage and INSERTs `deliverables`.

Per-task system prompts live in `worker/system_prompts.py` (one per task type: audit / quick / keywords / technical / backlinks / rankings / content_gap / report_pdf).

## Database schema cheat-sheet

11 tables (see `web/db/migrations/0001_init.sql` for full DDL):

- `workspaces` (tenant)
- `workspace_members` (user_id × workspace_id → role: `owner | staff | client_viewer`)
- `projects` (workspace × domain × notes_md)
- `tasks` (project × type × status × params_json × cost_usd)
- `task_steps` (task × idx × label × status × payload_json) — Realtime
- `deliverables` (task × kind × storage_path × public_token × expires_at)
- `watchlist_keywords` + `ranking_snapshots` (Phase 2 cron audit feature)
- `share_events` (deliverable × recipient × sent/opened/clicks)
- `usage_counters` (workspace × period — Phase 2 quota metering)
- `audit_log` (generic security audit trail)

RLS on every table. Helpers: `is_workspace_member(ws_id)` (security definer) + `public_share_view(token)` (security definer, anon-grantable).

## Things to know that aren't obvious from the code

- **Supabase clients are intentionally untyped.** The hand-written `Database` interface collapses Insert/Update generics to `never` under supabase-js 2.105+. Use the `insertRow` / `updateRow` helpers in `web/lib/supabase/admin.ts` so the one ugly cast lives in one place. Long-term fix: run `supabase gen types` and re-add the generic.
- **Step rows dedupe by `label` in the UI.** Worker emits `record_step("X", "running")` then `record_step("X", "succeeded")` — the timeline collapses to one row showing the latest status (highest `idx` wins).
- **Shared secret enforcement** is fail-safe: worker `/run` lets unauth requests through *only* in dev (`SUPABASE_URL` unset). Trigger.dev refuses to dispatch to non-localhost URLs without the secret.
- **The original `dataforseo-claude` CLI still works.** `seo/scripts/*.py --help` runs unchanged. The webapp imports the same scripts as a Python library.
- **Local dev runs all 4 services on Windows native (PowerShell).** WSL has Node 20 which is too old for pnpm@11 (needs Node ≥22.13).

## What to start a new conversation about

When you start a fresh chat, paste this whole file at the top of your first message, then say what you want to work on. Common next moves:

- Apply the Phase-2 fixes one at a time (auth guard, session refresh, Resend hardening — all small, low-risk).
- Wire the worker tool executors against the live DataForSEO API end-to-end (the existing `Quick scan` smoke test ran against stubs; the real ones are now wired but haven't been smoke-tested yet).
- Build the watchlist + scheduled-audits feature (Phase 2 hook for recurring revenue).
- Switch to magic-link auth once a custom Supabase SMTP provider (Resend) is configured.
- Add `supabase gen types` + re-type the supabase clients to delete the `as unknown as never` casts.
