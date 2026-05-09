# dataforseo-claude web

Next.js 15 (App Router) staff dashboard for the DataForSEO + Claude SEO
platform. Pairs with the FastAPI worker in [`../worker/`](../worker/)
and a Supabase project (Postgres + Auth + Storage + Realtime).

For the broader plan (architecture, data model, Phase 1 → Phase 2 scope)
see [`../plan.md`](../plan.md).

## Layout

```
web/
  app/
    (staff)/
      layout.tsx                  Sidebar + Toaster shell
      projects/
        page.tsx                  Project list + new-project dialog
        actions.ts                createProject Server Action
        [id]/
          page.tsx                Project detail (notes + run-task panel)
          task-buttons.tsx        Run-a-task buttons + prompt dialog
          tasks/[taskId]/
            page.tsx              Live timeline page shell
            task-timeline.tsx     Realtime-subscribed timeline + share UI
            actions.ts            mintDeliverableUrl + shareDeliverable
    login/                        Email + password sign-in
    share/[token]/                Public, read-only deliverable view
  db/
    migrations/                   0001 schema, 0002 security, 0003 QA
    policies.sql                  RLS policies (canonical copy)
    seed.sql                      Single agency workspace seed
  lib/
    supabase/{client,server,admin}.ts
    share.ts                      Token mint / verify / URL builder
    storage.ts                    Bucket-prefix helpers
    types.ts                      TaskRow / DeliverableRow / TaskStepRow
  src/trigger/run-task.ts         Trigger.dev task → POSTs to worker
  middleware.ts                   Security headers + /share rate limit
  trigger.config.ts               Trigger.dev project config
```

## Required env

Copy `.env.example` to `.env` and fill in:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key (RLS-aware reads). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-only writes). |
| `NEXT_PUBLIC_APP_URL` | Public origin used to build /share/<token> URLs. |
| `RESEND_API_KEY` / `RESEND_FROM` | Email-a-deliverable plumbing. |
| `WORKER_URL` | Where the FastAPI worker is reachable. |
| `WORKER_SHARED_SECRET` | Sent as `X-Worker-Secret`; must match the worker's value. |
| `TRIGGER_DEV_API_KEY` | Trigger.dev dispatch key. |

## Develop

```bash
pnpm install
pnpm dev
```

In a second terminal, run the worker (see `../worker/README.md`) and
Trigger.dev locally:

```bash
pnpm trigger:dev
```

## Build

```bash
pnpm build
```

## Database

Apply migrations in order to a fresh Supabase project:

```
db/migrations/0001_init.sql        — tables + indexes
db/migrations/0002_security.sql    — public_share_view hardening
db/migrations/0003_qa_hardening.sql — RLS WITH CHECK + last-owner guard
db/policies.sql                    — full RLS policy set (re-runnable)
db/seed.sql                        — agency workspace seed
```

After seeding, add yourself to `workspace_members` as `owner` via the
Supabase dashboard before signing in — Phase 1 has no UI for workspace
membership management.

## Phase 2

`/signup`, Stripe Checkout, `client_viewer` role, watchlist cron — all
deferred. See [`../plan.md`](../plan.md). The data model + worker do
not change in Phase 2; this is purely additive UI + billing wiring.
