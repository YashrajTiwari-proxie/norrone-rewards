import { supabaseAdmin } from './supabaseAdmin';
import type { CustomerRow } from './customerView';

function describeCondition(metric: string, operator: string, value: number): string {
	const op = operator === 'GTE' ? '≥' : operator === 'LTE' ? '≤' : '=';
	const label: Record<string, string> = {
		SPEND: 'Total spend',
		VISITS: 'Visits',
		POINTS: 'Points',
		TIER_LEVEL: 'Tier level',
		MEMBERSHIP_ACTIVE: 'Active membership'
	};
	return `${label[metric] ?? metric} ${op} ${value}`;
}

/** §6 GET /customers/:externalId/offers — personalized, secret or publishable. */
export async function buildPersonalizedOffers(customer: CustomerRow) {
	const { data: currentTierRow } = await supabaseAdmin
		.from('customer_tier')
		.select('tiers(level)')
		.eq('customer_id', customer.id)
		.order('achieved_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	const currentTierJoin = Array.isArray(currentTierRow?.tiers)
		? currentTierRow.tiers[0]
		: currentTierRow?.tiers;
	const currentLevel = currentTierJoin?.level ?? 0;

	const { data: nextTierRow } = await supabaseAdmin
		.from('tiers')
		.select('id, name, level')
		.eq('organization_id', customer.organization_id)
		.or(`shop_id.is.null,shop_id.eq.${customer.shop_id}`)
		.gt('level', currentLevel)
		.order('level', { ascending: true })
		.limit(1)
		.maybeSingle();

	let nextTier: { name: string; amountRemaining: number; metric: string } | null = null;
	if (nextTierRow) {
		const { data: condition } = await supabaseAdmin
			.from('eligibility_conditions')
			.select('metric, operator, value')
			.eq('target_type', 'TIER')
			.eq('target_id', nextTierRow.id)
			.eq('operator', 'GTE')
			.limit(1)
			.maybeSingle();

		if (condition) {
			let actual = 0;
			if (condition.metric === 'SPEND') actual = customer.total_spend;
			else if (condition.metric === 'VISITS') actual = customer.visit_count;

			nextTier = {
				name: nextTierRow.name,
				amountRemaining: Math.max(condition.value - actual, 0),
				metric: condition.metric
			};
		}
	}

	const { data: heldCouponDefIds } = await supabaseAdmin
		.from('coupon_instances')
		.select('coupon_definition_id')
		.eq('customer_id', customer.id);
	const heldIds = (heldCouponDefIds ?? []).map((r) => r.coupon_definition_id);

	let couponQuery = supabaseAdmin
		.from('coupon_definitions')
		.select('id, name')
		.eq('organization_id', customer.organization_id)
		.or(`shop_id.is.null,shop_id.eq.${customer.shop_id}`);
	if (heldIds.length > 0) {
		couponQuery = couponQuery.not('id', 'in', `(${heldIds.join(',')})`);
	}
	const { data: availableCouponDefs } = await couponQuery;

	const couponDefIds = (availableCouponDefs ?? []).map((def) => def.id);
	const { data: couponConditions } = couponDefIds.length
		? await supabaseAdmin
				.from('eligibility_conditions')
				.select('target_id, metric, operator, value')
				.eq('target_type', 'COUPON')
				.in('target_id', couponDefIds)
		: { data: [] };

	const availableCoupons = (availableCouponDefs ?? []).map((def) => {
		const condition = (couponConditions ?? []).find((c) => c.target_id === def.id);
		return {
			name: def.name,
			condition: condition ? describeCondition(condition.metric, condition.operator, condition.value) : null
		};
	});

	const { data: activePlanIds } = await supabaseAdmin
		.from('customer_memberships')
		.select('plan_id')
		.eq('customer_id', customer.id)
		.eq('status', 'ACTIVE')
		.gt('expiry_date', new Date().toISOString());
	const activeIds = (activePlanIds ?? []).map((r) => r.plan_id);

	let planQuery = supabaseAdmin
		.from('membership_plans')
		.select('name, price')
		.eq('organization_id', customer.organization_id)
		.or(`shop_id.is.null,shop_id.eq.${customer.shop_id}`);
	if (activeIds.length > 0) {
		planQuery = planQuery.not('id', 'in', `(${activeIds.join(',')})`);
	}
	const { data: membershipPlansAvailable } = await planQuery;

	return {
		nextTier,
		availableCoupons,
		membershipPlansAvailable: membershipPlansAvailable ?? []
	};
}

/** §6 GET /shops/:shopId/offers — public, non-personalized, cacheable. */
export async function buildPublicOffers(organizationId: string, shopId: string) {
	const scopeFilter = `shop_id.is.null,shop_id.eq.${shopId}`;

	const { data: membershipPlans } = await supabaseAdmin
		.from('membership_plans')
		.select('name, price')
		.eq('organization_id', organizationId)
		.or(scopeFilter);

	const { data: tiers } = await supabaseAdmin
		.from('tiers')
		.select('id, name')
		.eq('organization_id', organizationId)
		.or(scopeFilter);

	const tierIds = (tiers ?? []).map((t) => t.id);
	const { data: tierConditions } = tierIds.length
		? await supabaseAdmin
				.from('eligibility_conditions')
				.select('target_id, metric, operator, value')
				.eq('target_type', 'TIER')
				.eq('metric', 'SPEND')
				.eq('operator', 'GTE')
				.in('target_id', tierIds)
		: { data: [] };

	const publicTiers = (tiers ?? []).map((tier) => {
		const condition = (tierConditions ?? []).find((c) => c.target_id === tier.id);
		return { name: tier.name, threshold: condition?.value ?? null };
	});

	const { data: coupons } = await supabaseAdmin
		.from('coupon_definitions')
		.select('name')
		.eq('organization_id', organizationId)
		.or(scopeFilter)
		.eq('member_only', false);

	return {
		membershipPlans: membershipPlans ?? [],
		publicTiers,
		publicCoupons: coupons ?? []
	};
}
