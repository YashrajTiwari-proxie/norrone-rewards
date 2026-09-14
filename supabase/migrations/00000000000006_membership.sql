-- Build order step 6: membership_plans, customer_memberships, enroll_membership
-- See CLAUDE_CODE_BUILD_SPEC_V2_SUPABASE.md §3, §4, §5.2, §9.6

create table membership_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid references shops(id),      -- null = org-wide template
  name text not null,
  price numeric not null,
  duration_days integer not null,
  point_multiplier numeric not null default 1.0
);
alter table membership_plans enable row level security;
create policy "staff manage membership plans" on membership_plans
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

create table customer_memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  plan_id uuid not null references membership_plans(id),
  status text not null check (status in ('ACTIVE','EXPIRED','CANCELLED')),
  start_date timestamptz not null default now(),
  expiry_date timestamptz not null
);
alter table customer_memberships enable row level security;
create policy "staff manage customer memberships" on customer_memberships
  for all using (exists (select 1 from customers c where c.id = customer_id and is_org_staff(c.organization_id)));

-- SHARED: GRANTS -----------------------------------------------------------
-- Table only for now — applying MEMBERSHIP_PLAN-sourced grants lands in
-- step 7 alongside member_only wiring; enroll_membership references it but
-- there are no rows yet, so it's a no-op until then.
create table granted_benefits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_type text not null check (source_type in ('MEMBERSHIP_PLAN','TIER')),
  source_id uuid not null,
  benefit_type text not null check (benefit_type in ('TIER','REWARD','COUPON','POINTS')),
  benefit_id uuid,
  points_amount numeric
);
alter table granted_benefits enable row level security;
create policy "staff manage granted benefits" on granted_benefits
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

-- §4: fold the active membership plan's multiplier into GREATEST().
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
    coalesce(
      (select mp.point_multiplier
       from customer_memberships cm
       join membership_plans mp on mp.id = cm.plan_id
       where cm.customer_id = p_customer_id and cm.status = 'ACTIVE'
       order by cm.start_date desc
       limit 1),
      1.0
    ),
    1.0
  );
$$;

-- member_only now has a real signal (§5.1, §5.3): an ACTIVE row in
-- customer_memberships. Wire it into both functions that stubbed it.
create or replace function is_active_member(p_customer_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from customer_memberships
    where customer_id = p_customer_id and status = 'ACTIVE' and expiry_date > now()
  );
$$;

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
      v_actual := case when is_active_member(p_customer_id) then 1 else 0 end;
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

create or replace function evaluate_and_grant(p_customer_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_org_id uuid;
  v_shop_id uuid;
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
      and (not member_only or is_active_member(p_customer_id))
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

-- §5.2 enroll_membership — granted_benefits application is a no-op until
-- step 7 populates the table. Idempotency-key handling is added in
-- migration 00000000000007.
create or replace function enroll_membership(p_customer_id uuid, p_plan_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_plan membership_plans%rowtype;
  v_granted jsonb;
begin
  select * into v_plan from membership_plans where id = p_plan_id;

  insert into customer_memberships (customer_id, plan_id, status, start_date, expiry_date)
  values (p_customer_id, p_plan_id, 'ACTIVE', now(), now() + make_interval(days => v_plan.duration_days));

  -- TODO(step 7): apply granted_benefits where source_type = 'MEMBERSHIP_PLAN', source_id = p_plan_id

  v_granted := evaluate_and_grant(p_customer_id);
  return jsonb_build_object('customerId', p_customer_id, 'newlyGranted', v_granted);
end;
$$;
