import { error } from '@sveltejs/kit';
import { supabaseAdmin } from './supabaseAdmin';
import { hashApiKey } from './apiKeys';
import type { ApiKeyType } from './apiKeys';

export interface ApiKeyContext {
	organizationId: string;
	shopId: string | null;
	keyType: ApiKeyType;
}

/**
 * The single manual tenant-isolation check for the public headless API (§2).
 * The service-role client bypasses RLS, so every route handler MUST call
 * this first and MUST filter/verify every subsequent query against the
 * returned organizationId (and shopId, if the route is shop-scoped).
 */
export async function requireApiKey(
	request: Request,
	opts: { requireSecret?: boolean } = {}
): Promise<ApiKeyContext> {
	const authHeader = request.headers.get('authorization') ?? '';
	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	if (!match) {
		error(401, 'Missing or malformed Authorization header.');
	}

	const plaintextKey = match[1];
	const hashedKey = hashApiKey(plaintextKey);

	const { data: key, error: dbError } = await supabaseAdmin
		.from('api_keys')
		.select('organization_id, shop_id, type, revoked')
		.eq('hashed_key', hashedKey)
		.maybeSingle();

	if (dbError) {
		error(500, 'Failed to validate API key.');
	}
	if (!key || key.revoked) {
		error(401, 'Invalid or revoked API key.');
	}
	if (opts.requireSecret && key.type !== 'secret') {
		error(403, 'This endpoint requires a secret key.');
	}

	return {
		organizationId: key.organization_id,
		shopId: key.shop_id,
		keyType: key.type as ApiKeyType
	};
}

/**
 * Verifies a route's :shopId param is within the API key's scope: the key
 * must belong to the same organization, and if it's shop-scoped
 * (shopId !== null), the param must match exactly.
 */
export function assertShopInScope(ctx: ApiKeyContext, requestedShopId: string) {
	if (ctx.shopId !== null && ctx.shopId !== requestedShopId) {
		error(403, 'This API key is not scoped to the requested shop.');
	}
}
