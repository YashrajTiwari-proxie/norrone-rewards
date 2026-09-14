-- Build order step 1: organizations, organization_staff, is_org_staff()
-- See CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md §2, §3, §9.1

create extension if not exists pgcrypto; -- for gen_random_uuid()

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table organization_staff (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff',
  unique (organization_id, user_id)
);

alter table organization_staff enable row level security;

create policy "staff see their own membership" on organization_staff
  for select using (user_id = auth.uid());

-- Core RLS helper — every other table's policies call this.
create or replace function is_org_staff(target_org uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from organization_staff
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

-- organizations itself has no direct FK to staff; gate it through is_org_staff
-- so a staff member can see/manage only the orgs they belong to.
alter table organizations enable row level security;

create policy "staff manage their organizations" on organizations
  for all using (is_org_staff(id)) with check (is_org_staff(id));
