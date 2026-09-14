import { error } from '@sveltejs/kit';
import { supabaseAdmin } from './supabaseAdmin';
import type { ApiKeyContext } from './apiAuth';
import { assertShopInScope } from './apiAuth';

/**
 * Loads a shop by :shopId param, verifying it belongs to the API key's
 * organization (and, if the key is shop-scoped, that it matches exactly).
 * This is the per-route half of the tenant check described in §2 —
 * requireApiKey() resolves the key, this resolves+verifies the resource.
 */
export async function loadShopInScope(ctx: ApiKeyContext, shopId: string) {
	assertShopInScope(ctx, shopId);

	const { data: shop, error: dbError } = await supabaseAdmin
		.from('shops')
		.select('id, organization_id, name, external_shop_id')
		.eq('id', shopId)
		.eq('organization_id', ctx.organizationId)
		.maybeSingle();

	if (dbError) {
		error(500, 'Failed to load shop.');
	}
	if (!shop) {
		error(404, 'Shop not found.');
	}

	return shop;
}
