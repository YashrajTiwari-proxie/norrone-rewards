import { error } from '@sveltejs/kit';
import { supabaseAdmin } from './supabaseAdmin';
import type { ApiKeyContext } from './apiAuth';

/** Loads a coupon instance, verifying (via its customer) it belongs to the API key's organization. */
export async function loadCouponInScope(ctx: ApiKeyContext, couponInstanceId: string) {
	const { data: coupon, error: dbError } = await supabaseAdmin
		.from('coupon_instances')
		.select('id, code, status, expires_at, customer_id, customers(organization_id)')
		.eq('id', couponInstanceId)
		.maybeSingle();

	if (dbError) error(500, 'Failed to load coupon.');

	const customerJoin = Array.isArray(coupon?.customers) ? coupon.customers[0] : coupon?.customers;
	if (!coupon || customerJoin?.organization_id !== ctx.organizationId) {
		error(404, 'Coupon not found.');
	}

	return coupon;
}
