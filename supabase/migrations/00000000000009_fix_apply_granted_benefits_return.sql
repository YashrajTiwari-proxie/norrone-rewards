-- Fixes apply_granted_benefits: it declared `returns jsonb` but had no
-- RETURN statement (2F005 "control reached end of function without
-- RETURN"). Callers use `perform` and never use the return value, so
-- `returns void` is correct.

drop function if exists apply_granted_benefits(uuid, text, uuid);

create or replace function apply_granted_benefits(p_customer_id uuid, p_source_type text, p_source_id uuid)
returns void language plpgsql as $$
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
