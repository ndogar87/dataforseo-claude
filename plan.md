# Plan — Webapp around dataforseo-claude

## Context

The existing `dataforseo-claude` repo is a Claude Code skill pack: 7 Python scripts that wrap the DataForSEO API, 13 sub-skills, and 5 parallel subagents that produce a composite SEO audit + ReportLab PDF. It runs locally in a CLI for one user at a time.

The agency wants a webapp built around it so staff can manage many client websites from one dashboard, run SEO tasks at the click of a button, and share results with clients. The same app must evolve into a SaaS where clients sign up, pay monthly, and watch AI-augmented SEO happen on their own websites.

The plan below builds **one multi-tenant app from day 1**, launches **staff-first** (no public signup), then opens client signup + Stripe + scheduling in Phase 2. The existing Python scripts are reused as a backend engine — no rewrite. Claude orchestrates each task via tool-use; clients see a clean step timeline, not raw model output.

---

## Architecture

Three deployable units:

1. **Web app** — Next.js 15 (App Router) on Vercel.
   - Server Components for reads, Server Actions for mutations.
   - Supabase Realtime subscription on `task_steps` for the live timeline.
   - Tailwind + shadcn/ui.
   - Email via Resend.
2. **Worker** — FastAPI on Railway (or Fly.io).
   - Imports the existing scripts in `seo/scripts/` as Python modules.
   - Exposes `POST /run` taking `{task_id, type, params}`.
   - Runs a Claude API agent loop with the DataForSEO scripts registered as tools.
   - Writes step rows + deliverables back to Supabase using a service-role token.
3. **Supabase**
   - Postgres (data + RLS), Auth (magic-link), Storage (PDFs), Realtime (timeline).

**Job dispatch:** Next.js inserts a `jobs` row → **Trigger.dev** picks it up (handles retries, scheduled cron audits, observability) → calls the worker's `/run`. Trigger.dev's free tier covers Phase 1 easily.

**Domain:** single subdomain `app.youragency.com`. Path-based tenant routing (`/p/<project>`, `/c/<workspace>`). Wildcard subdomains and white-label custom domains deferred to a later phase.

---

## Reusing the existing codebase

The webapp does **not** rewrite the Python. The worker imports each script directly:

| Existing file | Reused as |
|---|---|
| `seo/scripts/dataforseo_client.py` | Shared HTTP client. Use `call()`, `all_items()`, `flat_results()`, `normalize_domain()` as-is. Credentials read from env vars (already supported). |
| `seo/scripts/keyword_research.py` | `keyword_research` tool. Refactor `main()` so the subcommand bodies become callable functions (currently CLI-only via argparse). |
| `seo/scripts/serp_check.py` | `serp_check` tool. |
| `seo/scripts/backlinks.py` | `backlinks_*` tools (summary / refdomains / anchors). |
| `seo/scripts/on_page_audit.py` | `on_page_audit` tool. Long-running — use polling, write progress steps. |
| `seo/scripts/domain_overview.py` | `domain_overview` tool (overview / ranked / competitors / content_gap subcommands). |
| `seo/scripts/generate_pdf_report.py` | Final-deliverable pipeline. Consumes the same JSON shape defined in `seo/schema/audit_input.example.json` — keep the schema; produce JSON in that shape from the worker. |
| `seo/SKILL.md` | Reference for the audit composite formula: `0.25*keywords + 0.25*technical + 0.20*competitors + 0.15*content + 0.15*authority`. Port this formula into the worker. |
| `agents/seo-*.md` | Reference for what each per-area subagent does. Inform Claude's system prompt for each task type. |

**Refactor required:** every script's `main()` currently uses `argparse` and `sys.exit`. We split each into `cmd_<subcommand>(**params) -> dict` functions plus a thin CLI shim. The CLI keeps working for local dev; the worker imports the functions.

---

## Data model (Supabase Postgres)

Tables (all RLS-scoped by `workspace_id`):

- `workspaces` — tenant boundary. `id, name, slug, plan_tier, stripe_customer_id`.
- `workspace_members` — `workspace_id, user_id, role` where role ∈ `owner | staff | client_viewer`.
- `projects` — `id, workspace_id, domain, display_name, notes_md, archived_at`.
- `tasks` — `id, project_id, type, status, params_json, started_at, finished_at, cost_usd, error`. Status: `queued | running | succeeded | failed | cancelled`.
- `task_steps` — `id, task_id, idx, label, status, payload_json, started_at, finished_at`. Streamed by the worker; subscribed by the browser.
- `deliverables` — `id, task_id, kind, storage_path, public_token, expires_at`. Kinds: `pdf_report | json_audit | csv_keywords | markdown_summary`.
- `watchlist_keywords` — `id, project_id, keyword, location, language`.
- `ranking_snapshots` — `id, watchlist_keyword_id, captured_at, position, url`.
- `share_events` — `id, deliverable_id, recipient_email, sent_at, opened_at, click_count`.
- `usage_counters` — `workspace_id, period, audits_run, keywords_tracked, projects_count`. Updated by triggers; checked in `enforce_quota()`.
- `audit_log` — `id, workspace_id, actor_user_id, action, target_type, target_id, at, meta`.

Public share path validates `deliverables.public_token` + `expires_at` and bypasses RLS via a security-definer function — never via anon-key reads.

---

## Job execution flow (one task lifecycle)

1. Staff clicks "Run audit" on a project.
2. Server Action checks quota in `usage_counters`, inserts `tasks` row with `status='queued'`, returns `task_id`.
3. Browser navigates to `/p/<project>/tasks/<task_id>` and subscribes to `task_steps` + `tasks` via Supabase Realtime.
4. Trigger.dev fires the queued task; calls worker `POST /run`.
5. Worker boots a Claude API agent loop with these tools:
   - `keyword_research`, `serp_check`, `backlinks_summary`, `backlinks_refdomains`, `backlinks_anchors`, `on_page_audit`, `domain_overview` (with subcommand param)
   - `record_step(label, status, payload)` — INSERTs `task_steps`
   - `save_deliverable(kind, content)` — uploads to Storage, INSERTs `deliverables`
6. Claude calls `record_step("Fetching keyword data", running)` → tool → `record_step("✓ Keyword data", succeeded)` → next step.
7. On completion: `save_deliverable("json_audit", …)` then `save_deliverable("pdf_report", …)` (PDF produced by reusing `generate_pdf_report.py`). Worker sets `tasks.status='succeeded'`, increments `usage_counters.audits_run`.
8. **Sharing:** "Share" action mints a `public_token` (32 random bytes), sets `expires_at = now() + 30d`, sends a Resend email containing both the share URL and the PDF attachment, logs to `share_events`.
9. **Failures:** tool errors written as failed steps; Claude retries once with backoff before failing the task. Trigger.dev handles infra-level retries.

---

## Phase 1 — Staff launch (~6–8 weeks)

- Supabase magic-link auth, restricted to the agency email domain.
- One seeded workspace = the agency. All staff are `owner` or `staff`.
- Pages: `/projects` (list + new), `/projects/<id>` (overview + task buttons + notes), `/projects/<id>/tasks/<task_id>` (live timeline + final report), `/share/<token>` (public read-only report).
- MVP task buttons: **audit, quick, keywords, technical, backlinks, rankings, content-gap, report-pdf**. Defer competitors / content / compare / watchlist scheduling to v1.1.
- Share: link + email PDF via Resend.
- No billing UI, no signup. Quota checks wired but not enforced (set tier='internal').

## Phase 2 — SaaS open (~3–4 weeks more)

- `/signup` route creates a workspace + Stripe customer.
- `/pricing` on marketing site links to Stripe Checkout. Customer Portal handles upgrade/cancel.
- `client_viewer` role enforced via RLS — clients see only their own workspace.
- `enforce_quota()` middleware turned on for all task actions.
- Watchlist + Trigger.dev cron schedules (weekly/daily audits) shipped — the recurring-revenue hook.
- White-label PDF (swap agency logo for client logo) gated to top tier.
- First-login onboarding: enter domain → free `quick` audit → upsell.

**What carries over unchanged:** data model, worker, Claude orchestration, share-link UX, PDF pipeline. Phase 2 is mostly signup + Stripe webhooks + pricing page + cron.

---

## Critical files / paths

**Existing repo, to be refactored (split CLI shim from callable functions):**
- `seo/scripts/dataforseo_client.py`
- `seo/scripts/keyword_research.py`
- `seo/scripts/serp_check.py`
- `seo/scripts/backlinks.py`
- `seo/scripts/on_page_audit.py`
- `seo/scripts/domain_overview.py`
- `seo/scripts/generate_pdf_report.py`
- `seo/schema/audit_input.example.json` (keep as-is; reused as the audit JSON contract)

**New (web app — to be created in a separate `web/` directory or sibling repo):**
- `web/app/(staff)/projects/page.tsx`
- `web/app/(staff)/projects/[id]/page.tsx`
- `web/app/(staff)/projects/[id]/tasks/[taskId]/page.tsx`
- `web/app/share/[token]/page.tsx` (public read-only)
- `web/app/api/run-task/route.ts` (Server Action that inserts `tasks` + dispatches Trigger.dev)
- `web/lib/supabase/{server,client}.ts`
- `web/lib/quota.ts` — `enforce_quota(workspace, action)`
- `web/lib/share.ts` — token mint / verify / Resend send
- `web/db/migrations/0001_init.sql` — schema above
- `web/db/policies.sql` — RLS policies per table

**New (worker — separate `worker/` directory):**
- `worker/main.py` — FastAPI app + `/run` route
- `worker/agent.py` — Claude API tool-use loop
- `worker/tools.py` — registers each DataForSEO function as a Claude tool
- `worker/steps.py` — `record_step` / `save_deliverable` helpers writing to Supabase via service-role
- `worker/composite.py` — port the `0.25*keywords + 0.25*technical + 0.20*competitors + 0.15*content + 0.15*authority` formula from `seo/SKILL.md`
- `worker/Dockerfile` + `railway.toml` (or `fly.toml`)

**Infra:**
- Trigger.dev project with one job (`run-task`) and a cron schedule (Phase 2).
- Supabase project (Postgres + Auth + Storage + Realtime).
- Vercel project pointed at `web/`.
- Resend account + verified sending domain.

---

## Verification

End-to-end test plan once Phase 1 is built:

1. **Local script refactor** — run each refactored script's CLI with the same flags listed in `seo/SKILL.md`'s "How To Run Each Command" section; outputs must match prior behavior. Then import each script and call `cmd_<subcommand>(**params)` in a Python REPL — must return the same dict the CLI prints.
2. **Supabase migrations** — apply `0001_init.sql` to a fresh project, run `supabase test db` (or manual SQL) to confirm RLS denies cross-workspace reads.
3. **Worker smoke** — `curl POST /run` with a small `keywords` task; confirm `task_steps` rows appear in Supabase as the run progresses, deliverable JSON shows up in Storage, `tasks.status='succeeded'`.
4. **Web app golden path** — log in as staff (magic link), create a project for `example.com`, click "Run quick audit", watch the timeline render in real time, see the final PDF download. Take ~60s end to end.
5. **Long-running audit** — full `audit` task on a real domain; confirm the worker survives a 2–5 minute `on_page` crawl and that DataForSEO costs land in `tasks.cost_usd`.
6. **Sharing** — click "Share with client", confirm the Resend email arrives with PDF attached and the share URL renders the read-only report; confirm `share_events.opened_at` updates on first open.
7. **Token security** — manually edit a `public_token` in the URL by one character → must 404. Wait past `expires_at` → must 410.
8. **Quota plumbing (dry run)** — set `usage_counters.audits_run` near the Pro tier limit, run another audit, confirm `enforce_quota` raises (even though the UI doesn't yet block on it in Phase 1).
9. **Cost monitoring** — after 10 real audits, average `tasks.cost_usd` and confirm Phase 2 tier quotas keep gross margin healthy before public launch.

If all nine pass, the staff launch is ready. Phase 2 (signup + Stripe + cron + RLS for `client_viewer`) is then layered on without touching the data model or worker.
