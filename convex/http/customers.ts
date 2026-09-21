import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { buildGoogleSaveUrl } from "../lib/wallet/googlePass";
import { requireApiKey, assertShopInScope, json, errorResponse, isWalletNotConfigured, matchShopsPath, CORS_HEADERS } from "./shared";

/**
 * Everything under /v1/shops/:shopId/... — customers are genuinely
 * shop-scoped (unlike membership plans/tiers/rewards/coupons, which are
 * org-level — see membershipPlans.ts etc.), so this keeps the
 * /v1/shops/:shopId/ prefix the original httpApiV1.ts used.
 *
 * Routes: offers, customers (list-less — create/get by externalId),
 * customer profile update/delete, membership enroll, points
 * (get ledger / manual adjust), and the wallet pass sub-routes.
 */
export async function dispatchCustomers(ctx: ActionCtx, request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const shopsMatch = matchShopsPath(url.pathname);
	if (!shopsMatch) return null;

	const isWrite = request.method !== "GET";
	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: isWrite });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	const shopId = shopsMatch.shopId as Id<"shops">;
	const scopeError = assertShopInScope(apiCtx, shopId);
	if (scopeError) return scopeError;

	const shop = await ctx.runQuery(internal.apiInternal.getShopInScope, { shopId, organizationId: apiCtx.organizationId });
	if (!shop) return errorResponse(404, "Shop not found.");

	const rest = shopsMatch.rest;

	// GET /v1/shops/:shopId/offers
	if (request.method === "GET" && rest.length === 1 && rest[0] === "offers") {
		const offers = await ctx.runQuery(internal.apiInternal.getPublicOffers, { organizationId: apiCtx.organizationId, shopId });
		return json(offers);
	}

	// POST /v1/shops/:shopId/customers
	if (request.method === "POST" && rest.length === 1 && rest[0] === "customers") {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.externalId !== "string" || !body.externalId) {
			return errorResponse(400, "externalId is required.");
		}
		const result = await ctx.runMutation(internal.apiInternal.createCustomer, {
			organizationId: apiCtx.organizationId,
			shopId,
			externalId: body.externalId,
			name: typeof body.name === "string" ? body.name : undefined,
			phone: typeof body.phone === "string" ? body.phone : undefined,
			email: typeof body.email === "string" ? body.email : undefined
		});
		if (result.conflict) return errorResponse(409, "A customer with this externalId already exists for this shop.");
		return json(result.view, 201);
	}

	if (rest[0] !== "customers" || !rest[1]) return errorResponse(404, "Not found.");
	const externalId = rest[1];

	// GET /v1/shops/:shopId/customers/:externalId/offers
	if (request.method === "GET" && rest.length === 3 && rest[2] === "offers") {
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");
		const offers = await ctx.runQuery(internal.apiInternal.getPersonalizedOffers, { customerId: customer._id });
		return json(offers);
	}

	// GET /v1/shops/:shopId/customers/:externalId/wallet/apple — the signed
	// .pkpass binary; GET .../wallet/google — the save-to-Google-Wallet URL as JSON.
	if (request.method === "GET" && rest.length === 4 && rest[2] === "wallet" && (rest[3] === "apple" || rest[3] === "google")) {
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");
		try {
			if (rest[3] === "apple") {
				const base64 = await ctx.runAction(internal.walletNode.buildApplePassBase64, { customerId: customer._id });
				const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
				return new Response(bytes, {
					status: 200,
					headers: {
						"content-type": "application/vnd.apple.pkpass",
						"content-disposition": "attachment; filename=loyalty.pkpass",
						"cache-control": "no-store",
						...CORS_HEADERS
					}
				});
			}
			const passData = await ctx.runQuery(internal.wallet.getPassData, { customerId: customer._id });
			const saveUrl = await buildGoogleSaveUrl(passData);
			return json({ saveUrl });
		} catch (err) {
			if (isWalletNotConfigured(err)) return errorResponse(503, err.data.message);
			throw err;
		}
	}

	// GET /v1/shops/:shopId/customers/:externalId/points — ledger + balance
	if (request.method === "GET" && rest.length === 3 && rest[2] === "points") {
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");
		const points = await ctx.runQuery(internal.apiInternal.getCustomerPoints, { customerId: customer._id });
		return json(points);
	}

	// POST /v1/shops/:shopId/customers/:externalId/points — manual grant/adjust
	if (request.method === "POST" && rest.length === 3 && rest[2] === "points") {
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");
		const body = await request.json().catch(() => null);
		if (!body || typeof body.amount !== "number") return errorResponse(400, "amount is required.");
		await ctx.runMutation(internal.customerGrants.internalAdjustPoints, {
			organizationId: apiCtx.organizationId,
			customerId: customer._id,
			amount: body.amount,
			note: typeof body.note === "string" ? body.note : undefined
		});
		const points = await ctx.runQuery(internal.apiInternal.getCustomerPoints, { customerId: customer._id });
		return json(points, 201);
	}

	// POST /v1/shops/:shopId/customers/:externalId/membership
	if (request.method === "POST" && rest.length === 3 && rest[2] === "membership") {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.planId !== "string" || !body.planId) return errorResponse(400, "planId is required.");
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");

		const plan = await ctx.runQuery(internal.apiInternal.getMembershipPlanInScope, {
			planId: body.planId as Id<"membershipPlans">,
			organizationId: apiCtx.organizationId,
			shopId
		});
		if (!plan) return errorResponse(404, "Membership plan not found.");

		await ctx.runMutation(internal.engine.enrollMembershipAction, {
			customerId: customer._id,
			planId: plan._id,
			idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined
		});

		const view = await ctx.runQuery(internal.apiInternal.getCustomerView, { shopId, externalId });
		return json(view, 201);
	}

	// PUT /v1/shops/:shopId/customers/:externalId — record a spend/visit event (unchanged path/semantics)
	if (request.method === "PUT" && rest.length === 2) {
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");

		const body = await request.json().catch(() => null);
		if (!body) return errorResponse(400, "Invalid JSON body.");

		const result = await ctx.runMutation(internal.engine.updateCustomerStatsAction, {
			customerId: customer._id,
			deltaSpend: typeof body.deltaSpend === "number" ? body.deltaSpend : undefined,
			deltaVisits: typeof body.deltaVisits === "number" ? body.deltaVisits : undefined,
			action: typeof body.action === "string" ? body.action : undefined,
			idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : undefined
		});

		const view = await ctx.runQuery(internal.apiInternal.getCustomerView, { shopId, externalId });
		if ("idempotent" in result) return json(view);

		const grantedTiers = result.newlyGranted.tiers;
		return json({
			...view,
			newlyGranted: {
				tier: grantedTiers.length > 0 ? { name: grantedTiers[0].name } : null,
				rewards: result.newlyGranted.rewards,
				coupons: result.newlyGranted.coupons
			}
		});
	}

	// PUT /v1/shops/:shopId/customers/:externalId/profile — update name/phone/email
	if (request.method === "PUT" && rest.length === 3 && rest[2] === "profile") {
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");
		const body = await request.json().catch(() => null);
		if (!body) return errorResponse(400, "Invalid JSON body.");
		await ctx.runMutation(internal.customers.internalUpdateProfile, {
			organizationId: apiCtx.organizationId,
			customerId: customer._id,
			name: typeof body.name === "string" ? body.name : undefined,
			phone: typeof body.phone === "string" ? body.phone : undefined,
			email: typeof body.email === "string" ? body.email : undefined
		});
		const view = await ctx.runQuery(internal.apiInternal.getCustomerView, { shopId, externalId });
		return json(view);
	}

	// DELETE /v1/shops/:shopId/customers/:externalId
	if (request.method === "DELETE" && rest.length === 2) {
		const customer = await ctx.runQuery(internal.apiInternal.getCustomerByExternalId, { shopId, externalId });
		if (!customer) return errorResponse(404, "Customer not found.");
		await ctx.runMutation(internal.customers.internalRemove, { organizationId: apiCtx.organizationId, customerId: customer._id });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
	}

	// GET /v1/shops/:shopId/customers/:externalId
	if (request.method === "GET" && rest.length === 2) {
		const view = await ctx.runQuery(internal.apiInternal.getCustomerView, { shopId, externalId });
		if (!view) return errorResponse(404, "Customer not found.");
		return json(view);
	}

	return errorResponse(404, "Not found.");
}
