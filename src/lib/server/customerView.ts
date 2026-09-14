import { error } from '@sveltejs/kit';
import { supabaseAdmin } from './supabaseAdmin';

export interface CustomerRow {
	id: string;
	organization_id: string;
	shop_id: string;
	external_id: string;
	name: string | null;
	phone: string | null;
	email: string | null;
	total_spend: number;
	visit_count: number;
	created_at: string;
}

/**
 * Builds the GET /customers/:externalId response shape from §6. Membership,
 * tier, points, rewards, and coupons are filled in as their tables/modules
 * land in later build-order steps (§9.4-8) — until then they report empty.
 */
export async function serializeCustomer(customer: CustomerRow) {
	const { data: ledgerRows, error: dbError } = await supabaseAdmin
		.from('point_ledger')
		.select('amount')
		.eq('customer_id', customer.id);

	if (dbError) {
		error(500, 'Failed to load point balance.');
	}

	const pointBalance = (ledgerRows ?? []).reduce((sum, row) => sum + Number(row.amount), 0);

	const { data: tierRow } = await supabaseAdmin
		.from('customer_tier')
		.select('achieved_at, tiers(name, level)')
		.eq('customer_id', customer.id)
		.order('achieved_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	const tierJoin = Array.isArray(tierRow?.tiers) ? tierRow.tiers[0] : tierRow?.tiers;
	const tier = tierJoin ? { name: tierJoin.name, level: tierJoin.level } : null;

	const { data: membershipRow } = await supabaseAdmin
		.from('customer_memberships')
		.select('expiry_date, membership_plans(name)')
		.eq('customer_id', customer.id)
		.eq('status', 'ACTIVE')
		.gt('expiry_date', new Date().toISOString())
		.order('start_date', { ascending: false })
		.limit(1)
		.maybeSingle();

	const planJoin = Array.isArray(membershipRow?.membership_plans)
		? membershipRow.membership_plans[0]
		: membershipRow?.membership_plans;
	const membership = planJoin
		? { planName: planJoin.name, expiresAt: membershipRow!.expiry_date }
		: null;

	const { data: rewardRows } = await supabaseAdmin
		.from('customer_rewards')
		.select('granted_at, reward_definitions(name)')
		.eq('customer_id', customer.id);

	const rewards = (rewardRows ?? []).map((row) => {
		const def = Array.isArray(row.reward_definitions) ? row.reward_definitions[0] : row.reward_definitions;
		return { name: def?.name ?? '', grantedAt: row.granted_at };
	});

	const { data: couponRows } = await supabaseAdmin
		.from('coupon_instances')
		.select('code, status, expires_at')
		.eq('customer_id', customer.id);

	const coupons = (couponRows ?? []).map((row) => ({
		code: row.code,
		status: row.status,
		expiresAt: row.expires_at
	}));

	return {
		externalId: customer.external_id,
		isMember: membership !== null,
		membership,
		tier,
		pointBalance,
		rewards,
		coupons
	};
}
