-- Platform-admin-managed list of supported countries (name, phone code,
-- default currency) so org/shop signup forms have a real dropdown instead
-- of a hardcoded list, and so currency selection can default sensibly from
-- country while still being overridable per shop (an org can be an MNC
-- with shops billing in different currencies than HQ).

create or replace function is_platform_admin()
returns boolean language sql stable as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create table regions (
  id uuid primary key default gen_random_uuid(),
  country_name text not null,
  iso_code text not null unique,       -- ISO 3166-1 alpha-2, e.g. 'IN'
  phone_code text not null,            -- e.g. '+91'
  currency_code text not null,         -- ISO 4217, e.g. 'INR'
  currency_symbol text not null,       -- e.g. '₹'
  created_at timestamptz not null default now()
);

alter table regions enable row level security;

-- Every signed-in user (staff or admin) needs to read this list to
-- populate a country/currency dropdown; only platform admins can change it.
create policy "any signed-in user can read regions" on regions
  for select using (auth.uid() is not null);

create policy "platform admins manage regions" on regions
  for all using (is_platform_admin()) with check (is_platform_admin());

insert into regions (country_name, iso_code, phone_code, currency_code, currency_symbol) values
  ('India', 'IN', '+91', 'INR', '₹'),
  ('United States', 'US', '+1', 'USD', '$'),
  ('United Kingdom', 'GB', '+44', 'GBP', '£'),
  ('United Arab Emirates', 'AE', '+971', 'AED', 'د.إ'),
  ('Singapore', 'SG', '+65', 'SGD', 'S$'),
  ('Australia', 'AU', '+61', 'AUD', 'A$'),
  ('Canada', 'CA', '+1', 'CAD', 'C$'),
  ('Germany', 'DE', '+49', 'EUR', '€'),
  ('France', 'FR', '+33', 'EUR', '€'),
  ('Saudi Arabia', 'SA', '+966', 'SAR', '﷼'),
  ('Qatar', 'QA', '+974', 'QAR', 'ر.ق'),
  ('Malaysia', 'MY', '+60', 'MYR', 'RM'),
  ('Indonesia', 'ID', '+62', 'IDR', 'Rp'),
  ('Philippines', 'PH', '+63', 'PHP', '₱'),
  ('South Africa', 'ZA', '+27', 'ZAR', 'R'),
  ('New Zealand', 'NZ', '+64', 'NZD', 'NZ$'),
  ('Japan', 'JP', '+81', 'JPY', '¥'),
  ('Sri Lanka', 'LK', '+94', 'LKR', 'Rs');

-- Organization-level business/contact details, captured at registration
-- time (both admin-created and self-serve /signup).
alter table organizations
  add column phone_number text,
  add column website text,
  add column address text,
  add column region_id uuid references regions(id),
  add column currency_code text,
  add column business_registration_number text,
  add column tax_id text;

-- Shops get the same fields, independent of the org's — an MNC-style org
-- can have shops in different countries/currencies than its HQ, so these
-- are pre-filled from the org's values at shop-creation time in the UI but
-- stored independently, not inherited live.
alter table shops
  add column phone_number text,
  add column address text,
  add column region_id uuid references regions(id),
  add column currency_code text;
