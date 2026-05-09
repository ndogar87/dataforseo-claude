-- 0002_security.sql
-- Hardening for Phase 1 security review.
--
--   1. `is_workspace_member` and `public_share_view` are security-definer
--      functions. Lock down their EXECUTE grants explicitly so an attacker
--      can't reach them via channels we don't intend.
--   2. `public_share_view` previously returned rows when `expires_at IS NULL`.
--      That is a soft fail-open: if a deliverable were ever inserted with no
--      expiry the link would be forever. Force a strict `expires_at > now()`
--      check so a missing expiry means the link is not viewable.
--
-- Safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1. Lock down EXECUTE on the security-definer helpers.
-- ---------------------------------------------------------------------------
revoke all on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

revoke all on function public.public_share_view(text) from public;
grant execute on function public.public_share_view(text) to anon;
grant execute on function public.public_share_view(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tighten public_share_view: never serve rows with a null/expired token.
-- ---------------------------------------------------------------------------
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
  -- p_token is a 43-char base64url string (32 bytes), so a length floor
  -- defangs accidental empty-string lookups and one-character probes.
  where coalesce(length(p_token), 0) >= 16
    and d.public_token = p_token
    and d.expires_at is not null
    and d.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- 3. Belt-and-braces: require deliverables.expires_at when public_token is set.
--     A row with a token but no expiry is a forever-link and should not
--     exist; enforce at the DB layer so a stray INSERT can't introduce one.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deliverables_token_requires_expiry'
  ) then
    alter table public.deliverables
      add constraint deliverables_token_requires_expiry
      check (public_token is null or expires_at is not null);
  end if;
end $$;
