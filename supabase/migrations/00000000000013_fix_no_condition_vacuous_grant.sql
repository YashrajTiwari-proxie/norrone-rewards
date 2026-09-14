-- Bug fix: evaluate_and_grant's TIER/REWARD/COUPON loops looped over each
-- definition's eligibility_conditions and started v_all_pass := true, so a
-- definition with ZERO conditions passed vacuously (an empty AND is true)
-- and auto-granted to every customer immediately. The dashboard's own copy
-- says "No conditions set — will never auto-grant" — this fix makes that
-- true: a definition needs at least one condition to ever be auto-granted.

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
      and exists (select 1 from eligibility_conditions ec where ec.target_type = 'TIER' and ec.target_id = tiers.id)
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
      and exists (
        select 1 from eligibility_conditions ec
        where ec.target_type = 'REWARD' and ec.target_id = reward_definitions.id
      )
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
      and exists (
        select 1 from eligibility_conditions ec
        where ec.target_type = 'COUPON' and ec.target_id = coupon_definitions.id
      )
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
