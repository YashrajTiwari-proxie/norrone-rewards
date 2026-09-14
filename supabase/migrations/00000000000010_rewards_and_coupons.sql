-- Build order step 8: reward_definitions, coupon_definitions, coupon
-- status machine + /redeem, fully wired into evaluate_and_grant and
-- apply_granted_benefits. See §3, §5.1, §6, §9.8.

create table reward_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid references shops(id),
  name text not null,
  description text,
  member_only boolean not null default false
);
alter table reward_definitions enable row level security;
create policy "staff manage reward definitions" on reward_definitions
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

create table customer_rewards (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  reward_id uuid not null references reward_definitions(id),
  granted_at timestamptz not null default now()
);
alter table customer_rewards enable row level security;
create policy "staff view customer rewards" on customer_rewards
  for all using (exists (select 1 from customers c where c.id = customer_id and is_org_staff(c.organization_id)));

create table coupon_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  shop_id uuid references shops(id),
  name text not null,
  discount_value numeric not null,
  discount_type text not null check (discount_type in ('PERCENTAGE','FIXED')),
  validity_days integer not null,
  member_only boolean not null default false
);
alter table coupon_definitions enable row level security;
create policy "staff manage coupon definitions" on coupon_definitions
  for all using (is_org_staff(organization_id)) with check (is_org_staff(organization_id));

create table coupon_instances (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  coupon_definition_id uuid not null references coupon_definitions(id),
  code text not null unique,
  status text not null check (status in ('ISSUED','REDEEMED','EXPIRED','CANCELLED')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz
);
alter table coupon_instances enable row level security;
create policy "staff manage coupon instances" on coupon_instances
  for all using (exists (select 1 from customers c where c.id = customer_id and is_org_staff(c.organization_id)));

create or replace function generate_coupon_code()
returns text language sql volatile as $$
  select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10));
$$;

drop function if exists apply_granted_benefits(uuid, text, uuid);

create or replace function apply_granted_benefits(p_customer_id uuid, p_source_type text, p_source_id uuid)
returns jsonb language plpgsql as $$
declare
  v_benefit granted_benefits%rowtype;
  v_coupon_def coupon_definitions%rowtype;
  v_code text;
  v_granted_rewards jsonb := '[]'::jsonb;
  v_granted_coupons jsonb := '[]'::jsonb;
begin
  for v_benefit in
    select * from granted_benefits
    where source_type = p_source_type and source_id = p_source_id
  loop
    case v_benefit.benefit_type
      when 'POINTS' then
        insert into point_ledger (customer_id, amount, reason, reference_id)
        values (p_customer_id, coalesce(v_benefit.points_amount, 0), 'MANUAL', p_source_type || ':' || p_source_id);

      when 'TIER' then
        if not exists (
          select 1 from customer_tier where customer_id = p_customer_id and tier_id = v_benefit.benefit_id
        ) then
          insert into customer_tier (customer_id, tier_id, source) values (p_customer_id, v_benefit.benefit_id, 'AUTO');
        end if;

      when 'REWARD' then
        if not exists (
          select 1 from customer_rewards where customer_id = p_customer_id and reward_id = v_benefit.benefit_id
        ) then
          insert into customer_rewards (customer_id, reward_id) values (p_customer_id, v_benefit.benefit_id);
          v_granted_rewards := v_granted_rewards || jsonb_build_object('id', v_benefit.benefit_id);
        end if;

      when 'COUPON' then
        select * into v_coupon_def from coupon_definitions where id = v_benefit.benefit_id;
        v_code := generate_coupon_code();
        insert into coupon_instances (customer_id, coupon_definition_id, code, status, expires_at)
        values (p_customer_id, v_benefit.benefit_id, v_code, 'ISSUED', now() + make_interval(days => v_coupon_def.validity_days));
        v_granted_coupons := v_granted_coupons || jsonb_build_object('code', v_code, 'status', 'ISSUED');
    end case;
  end loop;

  return jsonb_build_object('rewards', v_granted_rewards, 'coupons', v_granted_coupons);
end;
$$;

-- Full evaluate_and_grant (§5.1): tiers, then rewards, then coupons.
-- Each grant applies its own granted_benefits once (no recursion, per §5.1).
create or replace function evaluate_and_grant(p_customer_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_org_id uuid;
  v_shop_id uuid;
  v_is_member boolean;
  v_tier tiers%rowtype;
  v_reward reward_definitions%rowtype;
  v_coupon_def coupon_definitions%rowtype;
  v_condition eligibility_conditions%rowtype;
  v_all_pass boolean;
  v_granted_tiers jsonb := '[]'::jsonb;
  v_granted_rewards jsonb := '[]'::jsonb;
  v_granted_coupons jsonb := '[]'::jsonb;
  v_benefit_result jsonb;
  v_code text;
begin
  select organization_id, shop_id into v_org_id, v_shop_id from customers where id = p_customer_id;
  v_is_member := is_active_member(p_customer_id);

  -- TIER ------------------------------------------------------------------
  for v_tier in
    select * from tiers
    where organization_id = v_org_id
      and (shop_id is null or shop_id = v_shop_id)
      and id not in (select tier_id from customer_tier where customer_id = p_customer_id)
  loop
    v_all_pass := true;
    for v_condition in
      select * from eligibility_conditions where target_type = 'TIER' and target_id = v_tier.id
    loop
      if not eval_condition(p_customer_id, v_condition) then
        v_all_pass := false;
        exit;
      end if;
    end loop;

    if v_all_pass then
      insert into customer_tier (customer_id, tier_id, source) values (p_customer_id, v_tier.id, 'AUTO');
      v_granted_tiers := v_granted_tiers || jsonb_build_object('id', v_tier.id, 'name', v_tier.name);
      v_benefit_result := apply_granted_benefits(p_customer_id, 'TIER', v_tier.id);
      v_granted_rewards := v_granted_rewards || (v_benefit_result->'rewards');
      v_granted_coupons := v_granted_coupons || (v_benefit_result->'coupons');
    end if;
  end loop;

  -- REWARD ------------------------------------------------------------------
  for v_reward in
    select * from reward_definitions
    where organization_id = v_org_id
      and (shop_id is null or shop_id = v_shop_id)
      and (not member_only or v_is_member)
      and id not in (select reward_id from customer_rewards where customer_id = p_customer_id)
  loop
    v_all_pass := true;
    for v_condition in
      select * from eligibility_conditions where target_type = 'REWARD' and target_id = v_reward.id
    loop
      if not eval_condition(p_customer_id, v_condition) then
        v_all_pass := false;
        exit;
      end if;
    end loop;

    if v_all_pass then
      insert into customer_rewards (customer_id, reward_id) values (p_customer_id, v_reward.id);
      v_granted_rewards := v_granted_rewards || jsonb_build_object('id', v_reward.id, 'name', v_reward.name);
    end if;
  end loop;

  -- COUPON ------------------------------------------------------------------
  for v_coupon_def in
    select * from coupon_definitions
    where organization_id = v_org_id
      and (shop_id is null or shop_id = v_shop_id)
      and (not member_only or v_is_member)
      and id not in (select coupon_definition_id from coupon_instances where customer_id = p_customer_id)
  loop
    v_all_pass := true;
    for v_condition in
      select * from eligibility_conditions where target_type = 'COUPON' and target_id = v_coupon_def.id
    loop
      if not eval_condition(p_customer_id, v_condition) then
        v_all_pass := false;
        exit;
      end if;
    end loop;

    if v_all_pass then
      v_code := generate_coupon_code();
      insert into coupon_instances (customer_id, coupon_definition_id, code, status, expires_at)
      values (p_customer_id, v_coupon_def.id, v_code, 'ISSUED', now() + make_interval(days => v_coupon_def.validity_days));
      v_granted_coupons := v_granted_coupons || jsonb_build_object('code', v_code, 'status', 'ISSUED');
    end if;
  end loop;

  return jsonb_build_object('tiers', v_granted_tiers, 'rewards', v_granted_rewards, 'coupons', v_granted_coupons);
end;
$$;

-- §6 POST /v1/coupons/:code/redeem — no :shopId in the URL, so this
-- service-role RPC does the tenant check itself: the coupon (via its
-- customer) must belong to the calling API key's organization (§2).
create or replace function redeem_coupon(p_code text, p_organization_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_coupon coupon_instances%rowtype;
  v_customer_org uuid;
begin
  select ci.* into v_coupon
  from coupon_instances ci
  where ci.code = p_code
  for update;

  if not found then
    return jsonb_build_object('error', 'NOT_FOUND');
  end if;

  select organization_id into v_customer_org from customers where id = v_coupon.customer_id;
  if v_customer_org is distinct from p_organization_id then
    return jsonb_build_object('error', 'NOT_FOUND'); -- don't leak existence across tenants
  end if;
  if v_coupon.status = 'REDEEMED' then
    return jsonb_build_object('error', 'ALREADY_REDEEMED');
  end if;
  if v_coupon.status in ('EXPIRED', 'CANCELLED') then
    return jsonb_build_object('error', 'NOT_REDEEMABLE');
  end if;
  if v_coupon.expires_at <= now() then
    update coupon_instances set status = 'EXPIRED' where id = v_coupon.id;
    return jsonb_build_object('error', 'EXPIRED');
  end if;

  update coupon_instances set status = 'REDEEMED', redeemed_at = now() where id = v_coupon.id;
  return jsonb_build_object('ok', true, 'couponInstanceId', v_coupon.id);
end;
$$;
