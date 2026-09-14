-- Build order step 11 (scaffolding): pass_templates from §3, plus
-- pass_registrations — not in the original spec's table list, but required
-- infrastructure for Apple's webServiceURL device-registration protocol
-- (register/unregister a device for push updates, list updatable passes,
-- fetch the latest pass) that §7 requires for auto-updating passes.
-- Actual .pkpass signing / Google Wallet JWTs need real credentials
-- (Apple Pass Type ID cert + WWDR cert + key, Google service account) —
-- not wired up yet; see src/lib/server/walletPass.ts.

create table pass_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid references shops(id),      -- null = org default, shop overrides branding
  logo_url text,
  icon_url text,
  background_color text,
  foreground_color text,
  organization_display_name text
);
alter table pass_templates enable row level security;
create policy "staff manage pass templates" on pass_templates
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

-- One row per (device, pass) a customer has added to Apple Wallet, so we
-- know which push tokens to notify when a loyalty card or coupon changes.
-- pass_type_identifier distinguishes the loyalty-card pass type from the
-- coupon pass type (Apple issues separate Pass Type IDs per template).
create table pass_registrations (
  id uuid primary key default gen_random_uuid(),
  device_library_identifier text not null,
  pass_type_identifier text not null,
  serial_number text not null,            -- customer_id (loyalty card) or coupon_instances.id (coupon pass)
  push_token text not null,
  created_at timestamptz not null default now(),
  unique (device_library_identifier, pass_type_identifier, serial_number)
);
-- No dashboard access needed; only ever touched by the service-role
-- webServiceURL routes that Apple Wallet itself calls.
