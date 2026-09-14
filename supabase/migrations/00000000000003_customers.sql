-- Build order step 3: customers
-- See CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md §3, §9.3

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  external_id text not null,             -- the org's own customer ID for this shop
  name text,
  phone text,
  email text,
  total_spend numeric not null default 0,
  visit_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (shop_id, external_id)
);
alter table customers enable row level security;
create policy "staff manage their org customers" on customers
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));
