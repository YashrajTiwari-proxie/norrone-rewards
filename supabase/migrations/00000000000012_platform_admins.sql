-- Platform admin area: a separate role from organization_staff, for
-- managing organizations across the whole platform (not scoped to one
-- org). Kept as its own table rather than overloading organization_staff,
-- since a platform admin isn't necessarily staff at any organization.

create table platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id)
);

alter table platform_admins enable row level security;

create policy "platform admins see their own membership" on platform_admins
  for select using (user_id = auth.uid());

-- No insert/update/delete policy: platform admins are granted only via the
-- service-role client (e.g. a one-off script), mirroring how
-- organization_staff rows are only ever written by the service role.
