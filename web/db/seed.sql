-- seed.sql
-- One workspace = the agency. No users seeded — first login is invited
-- manually via the Supabase dashboard, then added to workspace_members.

insert into public.workspaces (name, slug, plan_tier)
values ('Agency', 'agency', 'internal')
on conflict (slug) do nothing;
