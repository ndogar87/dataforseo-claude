-- policies.sql
-- Row-level security: every row is visible iff the requesting user is a
-- member of the workspace that (transitively) owns it.

-- ---------------------------------------------------------------------------
-- Helper: is_workspace_member(ws_id)
-- ---------------------------------------------------------------------------
create or replace function public.is_workspace_member(ws_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = ws_id
      and wm.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects          enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_steps        enable row level security;
alter table public.deliverables      enable row level security;
alter table public.watchlist_keywords enable row level security;
alter table public.ranking_snapshots enable row level security;
alter table public.share_events      enable row level security;
alter table public.usage_counters    enable row level security;
alter table public.audit_log         enable row level security;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
drop policy if exists workspaces_member_select on public.workspaces;
create policy workspaces_member_select on public.workspaces
  for select using (public.is_workspace_member(id));

drop policy if exists workspaces_owner_update on public.workspaces;
create policy workspaces_owner_update on public.workspaces
  for update using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- workspace_members
-- ---------------------------------------------------------------------------
drop policy if exists workspace_members_self_select on public.workspace_members;
create policy workspace_members_self_select on public.workspace_members
  for select using (
    user_id = auth.uid()
    or public.is_workspace_member(workspace_id)
  );

drop policy if exists workspace_members_owner_write on public.workspace_members;
create policy workspace_members_owner_write on public.workspace_members
  for all using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspace_members.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
drop policy if exists projects_member_all on public.projects;
create policy projects_member_all on public.projects
  for all using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- tasks (parent: projects)
-- ---------------------------------------------------------------------------
drop policy if exists tasks_member_all on public.tasks;
create policy tasks_member_all on public.tasks
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = tasks.project_id
        and public.is_workspace_member(p.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- task_steps (parent: tasks → projects)
-- ---------------------------------------------------------------------------
drop policy if exists task_steps_member_all on public.task_steps;
create policy task_steps_member_all on public.task_steps
  for all using (
    exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_steps.task_id
        and public.is_workspace_member(p.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- deliverables
-- ---------------------------------------------------------------------------
drop policy if exists deliverables_member_all on public.deliverables;
create policy deliverables_member_all on public.deliverables
  for all using (
    exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = deliverables.task_id
        and public.is_workspace_member(p.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- watchlist_keywords
-- ---------------------------------------------------------------------------
drop policy if exists watchlist_keywords_member_all on public.watchlist_keywords;
create policy watchlist_keywords_member_all on public.watchlist_keywords
  for all using (
    exists (
      select 1 from public.projects p
      where p.id = watchlist_keywords.project_id
        and public.is_workspace_member(p.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- ranking_snapshots
-- ---------------------------------------------------------------------------
drop policy if exists ranking_snapshots_member_all on public.ranking_snapshots;
create policy ranking_snapshots_member_all on public.ranking_snapshots
  for all using (
    exists (
      select 1
      from public.watchlist_keywords wk
      join public.projects p on p.id = wk.project_id
      where wk.id = ranking_snapshots.watchlist_keyword_id
        and public.is_workspace_member(p.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- share_events
-- ---------------------------------------------------------------------------
drop policy if exists share_events_member_all on public.share_events;
create policy share_events_member_all on public.share_events
  for all using (
    exists (
      select 1
      from public.deliverables d
      join public.tasks t on t.id = d.task_id
      join public.projects p on p.id = t.project_id
      where d.id = share_events.deliverable_id
        and public.is_workspace_member(p.workspace_id)
    )
  );

-- ---------------------------------------------------------------------------
-- usage_counters
-- ---------------------------------------------------------------------------
drop policy if exists usage_counters_member_all on public.usage_counters;
create policy usage_counters_member_all on public.usage_counters
  for all using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
drop policy if exists audit_log_member_select on public.audit_log;
create policy audit_log_member_select on public.audit_log
  for select using (public.is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- public_share_view(token)
--
-- Returns the deliverable plus its parent task and project for an
-- unexpired public_token. Used by /share/[token] via the anon key.
-- Bypasses RLS via security definer. Does NOT return rows for expired
-- tokens or unknown tokens.
-- ---------------------------------------------------------------------------
drop function if exists public.public_share_view(text);
create or replace function public.public_share_view(p_token text)
returns table (
  deliverable_id uuid,
  deliverable_kind text,
  storage_path text,
  expires_at timestamptz,
  task_id uuid,
  task_type text,
  task_status text,
  task_finished_at timestamptz,
  project_id uuid,
  project_domain text,
  project_display_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.id            as deliverable_id,
    d.kind          as deliverable_kind,
    d.storage_path,
    d.expires_at,
    t.id            as task_id,
    t.type          as task_type,
    t.status        as task_status,
    t.finished_at   as task_finished_at,
    p.id            as project_id,
    p.domain        as project_domain,
    p.display_name  as project_display_name
  from public.deliverables d
  join public.tasks t      on t.id = d.task_id
  join public.projects p   on p.id = t.project_id
  where d.public_token = p_token
    and (d.expires_at is null or d.expires_at > now());
$$;

grant execute on function public.public_share_view(text) to anon;
grant execute on function public.public_share_view(text) to authenticated;
