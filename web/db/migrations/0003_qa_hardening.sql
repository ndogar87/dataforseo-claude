-- 0003_qa_hardening.sql
-- QA pass hardening: tighten two RLS policies plus a delete guard.
--
--   1. `workspaces_owner_update` previously had a USING clause but no
--      WITH CHECK. The two clauses are independent in Postgres — without
--      WITH CHECK, an owner could in principle update a row in a way
--      that produced a new row they themselves wouldn't be allowed to
--      see. Mirror the USING predicate as WITH CHECK so the policy is
--      symmetric.
--
--   2. `workspace_members` is currently `for all` with a single
--      `using` clause. That permits a sole owner to DELETE their own
--      membership row and orphan the workspace (no remaining owner =
--      no one can administer it). Add a BEFORE DELETE trigger that
--      refuses to remove the last `owner` of a workspace. Owners can
--      still leave once another owner has been added; clients/staff
--      removals are unaffected.
--
-- Safe to re-apply.

-- ---------------------------------------------------------------------------
-- 1. workspaces_owner_update — add WITH CHECK
-- ---------------------------------------------------------------------------
drop policy if exists workspaces_owner_update on public.workspaces;
create policy workspaces_owner_update on public.workspaces
  for update
  using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = workspaces.id
        and wm.user_id = auth.uid()
        and wm.role = 'owner'
    )
  );

-- ---------------------------------------------------------------------------
-- 2. workspace_members — refuse to remove the last owner
-- ---------------------------------------------------------------------------
create or replace function public.prevent_last_owner_removal()
returns trigger
language plpgsql
as $$
declare
  remaining_owners int;
begin
  -- Only enforce when removing an owner row. Staff / client_viewer
  -- deletions are unconstrained.
  if old.role <> 'owner' then
    return old;
  end if;

  select count(*) into remaining_owners
  from public.workspace_members
  where workspace_id = old.workspace_id
    and role = 'owner'
    and (user_id, workspace_id) <> (old.user_id, old.workspace_id);

  if remaining_owners = 0 then
    raise exception
      'Cannot remove the last owner of workspace %; promote another member to owner first.',
      old.workspace_id
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

drop trigger if exists prevent_last_owner_removal_trg on public.workspace_members;
create trigger prevent_last_owner_removal_trg
  before delete on public.workspace_members
  for each row execute function public.prevent_last_owner_removal();

-- The trigger also catches owner -> non-owner role updates that would
-- leave the workspace ownerless. Guard the UPDATE path with a sibling
-- function so the rule holds regardless of which DML the caller uses.
create or replace function public.prevent_last_owner_demotion()
returns trigger
language plpgsql
as $$
declare
  remaining_owners int;
begin
  if old.role = 'owner' and new.role <> 'owner' then
    select count(*) into remaining_owners
    from public.workspace_members
    where workspace_id = old.workspace_id
      and role = 'owner'
      and (user_id, workspace_id) <> (old.user_id, old.workspace_id);

    if remaining_owners = 0 then
      raise exception
        'Cannot demote the last owner of workspace %; promote another member to owner first.',
        old.workspace_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_last_owner_demotion_trg on public.workspace_members;
create trigger prevent_last_owner_demotion_trg
  before update on public.workspace_members
  for each row execute function public.prevent_last_owner_demotion();
