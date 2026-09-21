import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { requireApiKey, json, errorResponse, segments } from "./shared";

/** GET/POST /v1/tiers, GET/PUT/DELETE /v1/tiers/:id — see membershipPlans.ts's identical shape/comment. */
export async function dispatchTiers(ctx: ActionCtx, request: Request): Promise<Response | null> {
	const url = new URL(request.url);
	const segs = segments(url.pathname);
	if (segs[0] !== "v1" || segs[1] !== "tiers") return null;
	const id = segs[2] as Id<"tiers"> | undefined;
	if (segs.length > 3) return null;

	const isWrite = request.method !== "GET";
	const apiCtxOrError = await requireApiKey(ctx, request, { requireSecret: isWrite });
	if (apiCtxOrError instanceof Response) return apiCtxOrError;
	const apiCtx = apiCtxOrError;

	if (request.method === "GET" && !id) {
		const shopId = url.searchParams.get("shopId") as Id<"shops"> | null;
		let tiers = await ctx.runQuery(internal.tiers.internalList, { organizationId: apiCtx.organizationId });
		if (shopId) tiers = tiers.filter((t) => t.shopId === shopId || t.shopId == null);
		return json(tiers);
	}

	if (request.method === "GET" && id) {
		const tier = await ctx.runQuery(internal.tiers.internalGet, { organizationId: apiCtx.organizationId, tierId: id });
		if (!tier) return errorResponse(404, "Tier not found.");
		return json(tier);
	}

	if (request.method === "POST" && !id) {
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		if (typeof body.level !== "number") return errorResponse(400, "level is required.");
		if (typeof body.pointMultiplier !== "number") return errorResponse(400, "pointMultiplier is required.");
		const tierId = await ctx.runMutation(internal.tiers.internalCreate, {
			organizationId: apiCtx.organizationId,
			name: body.name,
			level: body.level,
			pointMultiplier: body.pointMultiplier,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const tier = await ctx.runQuery(internal.tiers.internalGet, { organizationId: apiCtx.organizationId, tierId });
		return json(tier, 201);
	}

	if (request.method === "PUT" && id) {
		const existing = await ctx.runQuery(internal.tiers.internalGet, { organizationId: apiCtx.organizationId, tierId: id });
		if (!existing) return errorResponse(404, "Tier not found.");
		const body = await request.json().catch(() => null);
		if (!body || typeof body.name !== "string" || !body.name) return errorResponse(400, "name is required.");
		if (typeof body.level !== "number") return errorResponse(400, "level is required.");
		if (typeof body.pointMultiplier !== "number") return errorResponse(400, "pointMultiplier is required.");
		await ctx.runMutation(internal.tiers.internalUpdate, {
			organizationId: apiCtx.organizationId,
			tierId: id,
			name: body.name,
			level: body.level,
			pointMultiplier: body.pointMultiplier,
			shopId: typeof body.shopId === "string" ? (body.shopId as Id<"shops">) : undefined
		});
		const tier = await ctx.runQuery(internal.tiers.internalGet, { organizationId: apiCtx.organizationId, tierId: id });
		return json(tier);
	}

	if (request.method === "DELETE" && id) {
		const existing = await ctx.runQuery(internal.tiers.internalGet, { organizationId: apiCtx.organizationId, tierId: id });
		if (!existing) return errorResponse(404, "Tier not found.");
		await ctx.runMutation(internal.tiers.internalRemove, { organizationId: apiCtx.organizationId, tierId: id });
		return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
	}

	return errorResponse(404, "Not found.");
}
