-- Build order step 2: shops, api_keys
-- See CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md §2, §3, §9.2

create table shops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  external_shop_id text,
  created_at timestamptz not null default now()
);
alter table shops enable row level security;
create policy "staff manage their org shops" on shops
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

create table api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid references shops(id),          -- null = valid for all shops under org
  hashed_key text not null unique,
  type text not null check (type in ('secret','publishable')),
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table api_keys enable row level security;
create policy "staff manage their org api keys" on api_keys
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));
