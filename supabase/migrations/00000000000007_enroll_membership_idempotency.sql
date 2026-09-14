-- Fixes enroll_membership to take an idempotency key, atomic with the enroll
-- transaction (matching update_customer_stats's pattern), instead of a
-- separate non-atomic app-level check.

drop function if exists enroll_membership(uuid, uuid);

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

  -- TODO(step 7): apply granted_benefits where source_type = 'MEMBERSHIP_PLAN', source_id = p_plan_id

  v_granted := evaluate_and_grant(p_customer_id);
  return jsonb_build_object('customerId', p_customer_id, 'newlyGranted', v_granted);
end;
$$;
