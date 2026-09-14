-- Build order step 5: eligibility_conditions + tiers + evaluate_and_grant (tier-only)
-- See CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md §3, §4, §5.1, §9.5

create table tiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid references shops(id),      -- null = org-wide template
  name text not null,
  level integer not null,
  point_multiplier numeric not null default 1.0
);
alter table tiers enable row level security;
create policy "staff manage tiers" on tiers
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

create table customer_tier (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  tier_id uuid not null references tiers(id),
  achieved_at timestamptz not null default now(),
  source text not null check (source in ('MANUAL','AUTO'))
);
alter table customer_tier enable row level security;
create policy "staff manage customer tier" on customer_tier
  for all using (exists (select 1 from customers c where c.id = customer_id and is_org_staff(c.organization_id)));

-- SHARED: ELIGIBILITY ---------------------------------------------------
-- Attached to Tier, Reward, or Coupon definitions only.
create table eligibility_conditions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  target_type text not null check (target_type in ('TIER','REWARD','COUPON')),
  target_id uuid not null,
  metric text not null check (metric in ('SPEND','VISITS','POINTS','TIER_LEVEL','MEMBERSHIP_ACTIVE')),
  operator text not null check (operator in ('GTE','LTE','EQ')),
  value numeric not null,
  period text not null check (period in ('LIFETIME','MONTHLY','YEARLY'))
);
alter table eligibility_conditions enable row level security;
create policy "staff manage eligibility conditions" on eligibility_conditions
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

-- §4: highest applicable multiplier — tier's now exists, membership lands in
-- step 6 and will be added to this GREATEST() then.
create or replace function applicable_multiplier(p_customer_id uuid)
returns numeric language sql stable as $$
  select greatest(
    coalesce(
      (select t.point_multiplier
       from customer_tier ct
       join tiers t on t.id = ct.tier_id
       where ct.customer_id = p_customer_id
       order by ct.achieved_at desc
       limit 1),
      1.0
    ),
    1.0
  );
$$;

-- Evaluates a single eligibility condition against a customer's current
-- stats. `period` support: LIFETIME uses the customer's running totals;
-- MONTHLY/YEARLY windowing needs per-period aggregates we don't have a
-- source for yet (no timestamped spend/visit events, only running
-- counters) — treated as LIFETIME for now. Revisit once such a need is
-- confirmed.
create or replace function eval_condition(p_customer_id uuid, p_condition eligibility_conditions)
returns boolean language plpgsql stable as $$
declare
  v_actual numeric;
begin
  case p_condition.metric
    when 'SPEND' then
      select total_spend into v_actual from customers where id = p_customer_id;
    when 'VISITS' then
      select visit_count into v_actual from customers where id = p_customer_id;
    when 'POINTS' then
      select coalesce(sum(amount), 0) into v_actual from point_ledger where customer_id = p_customer_id;
    when 'TIER_LEVEL' then
      select t.level into v_actual
      from customer_tier ct join tiers t on t.id = ct.tier_id
      where ct.customer_id = p_customer_id
      order by ct.achieved_at desc limit 1;
      v_actual := coalesce(v_actual, 0);
    when 'MEMBERSHIP_ACTIVE' then
      v_actual := 0; -- no memberships table yet (step 6); no ACTIVE membership is possible
    else
      return false;
  end case;

  return case p_condition.operator
    when 'GTE' then v_actual >= p_condition.value
    when 'LTE' then v_actual <= p_condition.value
    when 'EQ' then v_actual = p_condition.value
    else false
  end;
end;
$$;

-- §5.1 evaluate_and_grant — tier-only case for this step. Reward/coupon
-- grants and granted_benefits application land in steps 7-8.
create or replace function evaluate_and_grant(p_customer_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_org_id uuid;
  v_shop_id uuid;
  v_is_member boolean := false; -- no memberships table yet (step 6)
  v_tier tiers%rowtype;
  v_condition eligibility_conditions%rowtype;
  v_all_pass boolean;
  v_granted_tiers jsonb := '[]'::jsonb;
begin
  select organization_id, shop_id into v_org_id, v_shop_id from customers where id = p_customer_id;

  for v_tier in
    select * from tiers
    where organization_id = v_org_id
      and (shop_id is null or shop_id = v_shop_id)
      and id not in (select tier_id from customer_tier where customer_id = p_customer_id)
  loop
    v_all_pass := true;

    for v_condition in
      select * from eligibility_conditions
      where target_type = 'TIER' and target_id = v_tier.id
    loop
      if not eval_condition(p_customer_id, v_condition) then
        v_all_pass := false;
        exit;
      end if;
    end loop;

    if v_all_pass then
      insert into customer_tier (customer_id, tier_id, source) values (p_customer_id, v_tier.id, 'AUTO');
      v_granted_tiers := v_granted_tiers || jsonb_build_object('id', v_tier.id, 'name', v_tier.name);
      -- granted_benefits application for TIER grants lands in step 7.
    end if;
  end loop;

  return jsonb_build_object('tiers', v_granted_tiers, 'rewards', '[]'::jsonb, 'coupons', '[]'::jsonb);
end;
$$;

-- Wire evaluate_and_grant into update_customer_stats (§5.3's final step).
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
  v_granted jsonb;
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

  v_granted := evaluate_and_grant(p_customer_id);

  return jsonb_build_object('customerId', p_customer_id, 'newlyGranted', v_granted);
end;
$$;
