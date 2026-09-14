-- Build order step 4: point_rules, point_ledger, update_customer_stats (points only)
-- See CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md §3, §4, §5.3, §9.4

create table point_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid references shops(id),      -- null = org-wide template
  action text not null,                   -- PURCHASE | VISIT | REFERRAL | ...
  points_per_unit numeric not null,
  member_only boolean not null default false
);
alter table point_rules enable row level security;
create policy "staff manage point rules" on point_rules
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

create table point_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  amount numeric not null,                -- can be negative (reversal)
  reason text not null check (reason in ('ACTION','MANUAL','EXPIRY','REVERSAL')),
  reference_id text,
  created_at timestamptz not null default now()
);
alter table point_ledger enable row level security;
create policy "staff view point ledger" on point_ledger
  for all using (exists (select 1 from customers c where c.id = customer_id and is_org_staff(c.organization_id)));
-- balance = SUM(amount) for the customer. No mutable counter column.

create table idempotency_keys (
  key text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- No dashboard access needed; only ever touched by the service-role API layer.

-- §4: never stack multipliers — take the highest applicable one. No tier or
-- membership tables exist yet (steps 5-6), so both inputs are 1.0 for now;
-- this function is the single place §4's formula lives and gets extended
-- as those tables land.
create or replace function applicable_multiplier(p_customer_id uuid)
returns numeric language sql stable as $$
  select 1.0::numeric;
$$;

-- §5.3, points portion only — tier/reward/coupon auto-grant (evaluate_and_grant)
-- lands in step 5 and gets called from here then.
create or replace function update_customer_stats(
  p_customer_id uuid,
  p_delta_spend numeric,
  p_delta_visits integer,
  p_action text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer as $$
declare
  v_org_id uuid;
  v_shop_id uuid;
  v_is_member boolean := false;
  v_rule point_rules%rowtype;
  v_points numeric;
begin
  if p_idempotency_key is not null then
    begin
      insert into idempotency_keys (key, organization_id)
      select p_idempotency_key, organization_id from customers where id = p_customer_id;
    exception when unique_violation then
      return jsonb_build_object('idempotent', true);
    end;
  end if;

  select organization_id, shop_id into v_org_id, v_shop_id
  from customers where id = p_customer_id;

  update customers
  set total_spend = total_spend + coalesce(p_delta_spend, 0),
      visit_count = visit_count + coalesce(p_delta_visits, 0)
  where id = p_customer_id;

  if p_action is not null then
    select * into v_rule
    from point_rules
    where organization_id = v_org_id
      and (shop_id is null or shop_id = v_shop_id)
      and action = p_action
      and (not member_only or v_is_member)
    order by shop_id nulls last
    limit 1;

    if found then
      v_points := v_rule.points_per_unit * applicable_multiplier(p_customer_id);
      insert into point_ledger (customer_id, amount, reason, reference_id)
      values (p_customer_id, v_points, 'ACTION', p_action);
    end if;
  end if;

  return jsonb_build_object('customerId', p_customer_id);
end;
$$;
