import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { requireApiKey, json, errorResponse, segments, getOrNull } from "./shared";

/**
 * GET/POST /v1/coupons, GET/PUT/DELETE /v1/coupons/:id — coupon
 * *definitions* (types), same shape as membershipPlans.ts. Distinct from
 * POST /v1/coupons/:code/redeem (4 segments, literal "redeem" as the
 * last one — handled separately in httpApiV1.ts ahead of this
 * dispatcher, and skipped here since a 4-segment path falls through
 * below rather than 404ing, so redeem is never shadowed).
 */
export async function dispatchCoupons(ctx: ActionCtx, request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const segs = segments(url.pathname);
	if (segs[0] !== "v1" || segs[1] !== "coupons") return null;
	const id = segs[2] as Id<"couponDefinitions"> | undefined;
	if (segs.length > 3) return null; // e.g. the redeem action — not ours

	const isWrite = request.method !== "GET";
	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: isWrite });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	if (request.method === "GET" && !id) {
		const shopId = url.searchParams.get("shopId") as Id<"shops"> | null;
		let defs = await ctx.runQuery(internal.coupons.internalListDefinitions, { organizationId: apiCtx.organizationId });
		if (shopId) defs = defs.filter((d) => d.shopId === shopId || d.shopId == null);
		return json(defs);
	}

	if (request.method === "GET" && id) {
		const def = await getOrNull(() => ctx.runQuery(internal.coupons.internalGetDefinition, { organizationId: apiCtx.organizationId, couponDefinitionId: id }));
		if (!def) return errorResponse(404, "Coupon type not found.");
		return json(def);
	}

	if (request.method === "POST" && !id) {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		if (typeof body.discountValue !== "number") return errorResponse(400, "discountValue is required.");
		if (body.discountType !== "PERCENTAGE" && body.discountType !== "FIXED") return errorResponse(400, "discountType must be PERCENTAGE or FIXED.");
		if (typeof body.validityDays !== "number") return errorResponse(400, "validityDays is required.");
		const couponDefinitionId = await ctx.runMutation(internal.coupons.internalCreate, {
			organizationId: apiCtx.organizationId,
			name: body.name,
			discountValue: body.discountValue,
			discountType: body.discountType,
			validityDays: body.validityDays,
			memberOnly: typeof body.memberOnly === "boolean" ? body.memberOnly : false,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const def = await ctx.runQuery(internal.coupons.internalGetDefinition, { organizationId: apiCtx.organizationId, couponDefinitionId });
		return json(def, 201);
	}

	if (request.method === "PUT" && id) {
		const existing = await getOrNull(() => ctx.runQuery(internal.coupons.internalGetDefinition, { organizationId: apiCtx.organizationId, couponDefinitionId: id }));
		if (!existing) return errorResponse(404, "Coupon type not found.");
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		if (typeof body.discountValue !== "number") return errorResponse(400, "discountValue is required.");
		if (body.discountType !== "PERCENTAGE" && body.discountType !== "FIXED") return errorResponse(400, "discountType must be PERCENTAGE or FIXED.");
		if (typeof body.validityDays !== "number") return errorResponse(400, "validityDays is required.");
		await ctx.runMutation(internal.coupons.internalUpdate, {
			organizationId: apiCtx.organizationId,
			couponDefinitionId: id,
			name: body.name,
			discountValue: body.discountValue,
			discountType: body.discountType,
			validityDays: body.validityDays,
			memberOnly: typeof body.memberOnly === "boolean" ? body.memberOnly : false,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const def = await getOrNull(() => ctx.runQuery(internal.coupons.internalGetDefinition, { organizationId: apiCtx.organizationId, couponDefinitionId: id }));
		return json(def);
	}

	if (request.method === "DELETE" && id) {
		const existing = await getOrNull(() => ctx.runQuery(internal.coupons.internalGetDefinition, { organizationId: apiCtx.organizationId, couponDefinitionId: id }));
		if (!existing) return errorResponse(404, "Coupon type not found.");
		await ctx.runMutation(internal.coupons.internalRemove, { organizationId: apiCtx.organizationId, couponDefinitionId: id });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
	}

	return errorResponse(404, "Not found.");
}
