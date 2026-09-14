-- Build order step 7: member_only flags + granted_benefits wired into
-- evaluate_and_grant / enroll_membership. member_only on point_rules and
-- eval_condition's MEMBERSHIP_ACTIVE metric were already wired in migration
-- 00000000000006 (is_active_member existed once memberships did). §5.1
-- says "apply once, do not recurse" for TIER grants; REWARD/COUPON benefit
-- types are handled once reward_definitions/coupon_definitions exist in
-- step 8's migration, which replaces this function again. See §9.7.

-- Applies every granted_benefits row for one (source_type, source_id),
-- e.g. a TIER's or MEMBERSHIP_PLAN's benefits.
create or replace function apply_granted_benefits(p_customer_id uuid, p_source_type text, p_source_id uuid)
returns jsonb language plpgsql as $$
declare
  v_benefit granted_benefits%rowtype;
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

      else
        null; -- REWARD/COUPON: wired in step 8 once those tables exist.
    end case;
  end loop;
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
      perform apply_granted_benefits(p_customer_id, 'TIER', v_tier.id);
    end if;
  end loop;

  return jsonb_build_object('tiers', v_granted_tiers, 'rewards', '[]'::jsonb, 'coupons', '[]'::jsonb);
end;
$$;

create or replace function enroll_membership(p_customer_id uuid, p_plan_id uuid, p_idempotency_key text)
returns jsonb language plpgsql security definer as $$
declare
  v_plan membership_plans%rowtype;
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

  select * into v_plan from membership_plans where id = p_plan_id;

  insert into customer_memberships (customer_id, plan_id, status, start_date, expiry_date)
  values (p_customer_id, p_plan_id, 'ACTIVE', now(), now() + make_interval(days => v_plan.duration_days));

  perform apply_granted_benefits(p_customer_id, 'MEMBERSHIP_PLAN', p_plan_id);
  v_granted := evaluate_and_grant(p_customer_id);

  return jsonb_build_object('customerId', p_customer_id, 'newlyGranted', v_granted);
end;
$$;
