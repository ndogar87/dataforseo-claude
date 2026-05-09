-- 0001_init.sql
-- Initial schema for the DataForSEO-Claude staff dashboard.
-- All time fields are timestamptz. All PKs are gen_random_uuid() unless noted.
-- RLS is enabled and policies live in db/policies.sql.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- workspaces (tenant boundary)
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan_tier text not null default 'internal',
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- workspace_members (composite PK on workspace_id + user_id)
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'client_viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  domain text not null,
  display_name text not null,
  notes_md text not null default '',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_workspace_archived_idx
  on public.projects (workspace_id, archived_at);

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null,
  status text not null check (
    status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  params_json jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  cost_usd numeric not null default 0,
  error text
);

create index if not exists tasks_project_created_idx
  on public.tasks (project_id, created_at desc);

create index if not exists tasks_status_idx on public.tasks (status);

-- ---------------------------------------------------------------------------
-- task_steps
-- ---------------------------------------------------------------------------
create table if not exists public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  idx int not null,
  label text not null,
  status text not null check (
    status in ('pending', 'running', 'succeeded', 'failed')
  ),
  payload_json jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists task_steps_task_idx_idx
  on public.task_steps (task_id, idx);

-- ---------------------------------------------------------------------------
-- deliverables
-- ---------------------------------------------------------------------------
create table if not exists public.deliverables (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  kind text not null check (
    kind in ('pdf_report', 'json_audit', 'csv_keywords', 'markdown_summary')
  ),
  storage_path text not null,
  public_token text unique,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists deliverables_task_idx
  on public.deliverables (task_id);

-- ---------------------------------------------------------------------------
-- watchlist_keywords
-- ---------------------------------------------------------------------------
create table if not exists public.watchlist_keywords (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  keyword text not null,
  location text,
  language text,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists watchlist_keywords_project_idx
  on public.watchlist_keywords (project_id, archived_at);

-- ---------------------------------------------------------------------------
-- ranking_snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  watchlist_keyword_id uuid not null
    references public.watchlist_keywords(id) on delete cascade,
  captured_at timestamptz not null default now(),
  position int,
  url text
);

create index if not exists ranking_snapshots_keyword_time_idx
  on public.ranking_snapshots (watchlist_keyword_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- share_events
-- ---------------------------------------------------------------------------
create table if not exists public.share_events (
  id uuid primary key default gen_random_uuid(),
  deliverable_id uuid not null
    references public.deliverables(id) on delete cascade,
  recipient_email text,
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  click_count int not null default 0
);

create index if not exists share_events_deliverable_idx
  on public.share_events (deliverable_id);

-- ---------------------------------------------------------------------------
-- usage_counters (composite PK on workspace_id + period 'YYYY-MM')
-- ---------------------------------------------------------------------------
create table if not exists public.usage_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  period text not null, -- yyyy-mm
  audits_run int not null default 0,
  keywords_tracked int not null default 0,
  projects_count int not null default 0,
  primary key (workspace_id, period)
);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_type text,
  target_id uuid,
  at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists audit_log_workspace_at_idx
  on public.audit_log (workspace_id, at desc);
