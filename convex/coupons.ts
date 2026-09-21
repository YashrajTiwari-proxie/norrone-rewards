import { v, ConvexError } from "convex/values";
import { orgStaffQuery, orgStaffMutation, assertShopInOrg, assertPositive, assertNonNegative } from "./lib/authz";
import { internalQuery, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const metricLabel: Record<string, string> = {
	SPEND: "spend",
	VISITS: "visits",
	POINTS: "points",
	TIER_LEVEL: "tier level",
	MEMBERSHIP_ACTIVE: "active membership"
};
const opLabel: Record<string, string> = { GTE: "≥", LTE: "≤", EQ: "=" };
const STATUSES = ["ISSUED", "REDEEMED", "EXPIRED", "CANCELLED"] as const;
const PAGE_SIZE = 6;

async function listDefinitionsHandler(ctx: import("./_generated/server").QueryCtx, organizationId: Id<"organizations">) {
	const shops = await ctx.db
		.query("shops")
		.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
		.collect();
	const shopNameById = new Map(shops.map((s) => [s._id, s.name]));

	const definitions = await ctx.db
		.query("couponDefinitions")
		.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
		.collect();
	definitions.sort((a, b) => a.name.localeCompare(b.name));

	return await Promise.all(
		definitions.map(async (def) => {
			const conditions = await ctx.db
				.query("eligibilityConditions")
				.withIndex("by_target", (q) => q.eq("targetType", "COUPON").eq("targetId", def._id))
				.collect();
			const conditionSummary =
				conditions.map((c) => `${metricLabel[c.metric] ?? c.metric} ${opLabel[c.operator] ?? c.operator} ${c.value}`).join(", ") ||
				"No conditions";
			return {
				...def,
				scopeName: def.shopId ? (shopNameById.get(def.shopId) ?? "This shop") : "All shops",
				conditionSummary,
				conditions
			};
		})
	);
}

async function getDefinitionHandler(
	ctx: import("./_generated/server").QueryCtx,
	organizationId: Id<"organizations">,
	couponDefinitionId: Id<"couponDefinitions">
) {
	const def = await ctx.db.get(couponDefinitionId);
	if (!def || def.organizationId !== organizationId) return null;
	return def;
}

export const listDefinitions = orgStaffQuery("coupons:read")({
	args: {},
	handler: async (ctx) => listDefinitionsHandler(ctx, ctx.organizationId)
});

export const internalListDefinitions = internalQuery({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => listDefinitionsHandler(ctx, args.organizationId)
});

export const internalGetDefinition = internalQuery({
	args: { organizationId: v.id("organizations"), couponDefinitionId: v.id("couponDefinitions") },
	handler: async (ctx, args) => getDefinitionHandler(ctx, args.organizationId, args.couponDefinitionId)
});

/** Issued coupon instances — paginated, optionally filtered by status. */
export const listInstances = orgStaffQuery("coupons:read")({
	args: {
		status: v.optional(v.union(v.literal("ISSUED"), v.literal("REDEEMED"), v.literal("EXPIRED"), v.literal("CANCELLED"))),
		page: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const customers = await ctx.db
			.query("customers")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const customerById = new Map(customers.map((c) => [c._id, c]));

		const allInstances = (
			await Promise.all(
				customers.map((c) =>
					ctx.db
						.query("couponInstances")
						.withIndex("by_customer", (q) => q.eq("customerId", c._id))
						.collect()
				)
			)
		).flat();

		const statusCounts: Record<string, number> = {};
		for (const status of STATUSES) statusCounts[status] = 0;
		for (const inst of allInstances) statusCounts[inst.status] = (statusCounts[inst.status] ?? 0) + 1;

		const filtered = args.status ? allInstances.filter((i) => i.status === args.status) : allInstances;
		filtered.sort((a, b) => b._creationTime - a._creationTime);

		const pageNum = Math.max(1, args.page ?? 1);
		const pageSlice = filtered.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE);

		const instances = await Promise.all(
			pageSlice.map(async (inst) => {
				const customer = customerById.get(inst.customerId);
				const def = await ctx.db.get(inst.couponDefinitionId);
				return {
					id: inst._id,
					code: inst.code,
					status: inst.status,
					expiresAt: inst.expiresAt,
					holder: customer?.name ?? customer?.externalId ?? "Unknown",
					defName: def?.name ?? "",
					value: def ? (def.discountType === "PERCENTAGE" ? `${def.discountValue}%` : `₹${def.discountValue}`) : ""
				};
			})
		);

		return { instances, instanceCount: filtered.length, page: pageNum, pageSize: PAGE_SIZE, statusCounts };
	}
});

const couponFields = {
	name: v.string(),
	discountValue: v.number(),
	discountType: v.union(v.literal("PERCENTAGE"), v.literal("FIXED")),
	validityDays: v.number(),
	memberOnly: v.boolean(),
	shopId: v.optional(v.id("shops"))
};

async function createDefinitionHandler(
	ctx: import("./_generated/server").MutationCtx,
	organizationId: Id<"organizations">,
	args: { name: string; discountValue: number; discountType: "PERCENTAGE" | "FIXED"; validityDays: number; memberOnly: boolean; shopId?: Id<"shops"> }
) {
	assertPositive(args.discountValue, "discountValue");
	assertPositive(args.validityDays, "validityDays");
	await assertShopInOrg(ctx, args.shopId, organizationId);
	return await ctx.db.insert("couponDefinitions", { organizationId, ...args });
}

async function updateDefinitionHandler(
	ctx: import("./_generated/server").MutationCtx,
	organizationId: Id<"organizations">,
	couponDefinitionId: Id<"couponDefinitions">,
	fields: { name: string; discountValue: number; discountType: "PERCENTAGE" | "FIXED"; validityDays: number; memberOnly: boolean; shopId?: Id<"shops"> }
) {
	assertPositive(fields.discountValue, "discountValue");
	assertPositive(fields.validityDays, "validityDays");
	const def = await ctx.db.get(couponDefinitionId);
	if (!def || def.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Coupon type not found in this organization" });
	}
	await assertShopInOrg(ctx, fields.shopId, organizationId);
	await ctx.db.patch(couponDefinitionId, fields);
}

async function removeDefinitionHandler(
	ctx: import("./_generated/server").MutationCtx,
	organizationId: Id<"organizations">,
	couponDefinitionId: Id<"couponDefinitions">
) {
	const def = await ctx.db.get(couponDefinitionId);
	if (!def || def.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Coupon type not found in this organization" });
	}
	await ctx.db.delete(couponDefinitionId);
}

export const create = orgStaffMutation("coupons:write")({
	args: couponFields,
	handler: async (ctx, args) => {
		await createDefinitionHandler(ctx, ctx.organizationId, args);
	}
});

export const internalCreate = internalMutation({
	args: { organizationId: v.id("organizations"), ...couponFields },
	handler: async (ctx, args) => {
		const { organizationId, ...fields } = args;
		return await createDefinitionHandler(ctx, organizationId, fields);
	}
});

export const update = orgStaffMutation("coupons:write")({
	args: { couponDefinitionId: v.id("couponDefinitions"), ...couponFields },
	handler: async (ctx, args) => {
		const { couponDefinitionId, ...fields } = args;
		await updateDefinitionHandler(ctx, ctx.organizationId, couponDefinitionId, fields);
	}
});

export const internalUpdate = internalMutation({
	args: { organizationId: v.id("organizations"), couponDefinitionId: v.id("couponDefinitions"), ...couponFields },
	handler: async (ctx, args) => {
		const { organizationId, couponDefinitionId, ...fields } = args;
		await updateDefinitionHandler(ctx, organizationId, couponDefinitionId, fields);
	}
});

export const remove = orgStaffMutation("coupons:write")({
	args: { couponDefinitionId: v.id("couponDefinitions") },
	handler: async (ctx, args) => removeDefinitionHandler(ctx, ctx.organizationId, args.couponDefinitionId)
});

export const internalRemove = internalMutation({
	args: { organizationId: v.id("organizations"), couponDefinitionId: v.id("couponDefinitions") },
	handler: async (ctx, args) => removeDefinitionHandler(ctx, args.organizationId, args.couponDefinitionId)
});

export const addCondition = orgStaffMutation("coupons:write")({
	args: {
		couponDefinitionId: v.id("couponDefinitions"),
		metric: v.union(v.literal("SPEND"), v.literal("VISITS"), v.literal("POINTS"), v.literal("TIER_LEVEL"), v.literal("MEMBERSHIP_ACTIVE")),
		operator: v.union(v.literal("GTE"), v.literal("LTE"), v.literal("EQ")),
		value: v.number(),
		period: v.union(v.literal("LIFETIME"), v.literal("MONTHLY"), v.literal("YEARLY"))
	},
	handler: async (ctx, args) => {
		const { couponDefinitionId, ...fields } = args;
		assertNonNegative(fields.value, "value");
		const def = await ctx.db.get(couponDefinitionId);
		if (!def || def.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Coupon type not found in this organization" });
		}
		await ctx.db.insert("eligibilityConditions", {
			organizationId: ctx.organizationId,
			targetType: "COUPON",
			targetId: couponDefinitionId,
			...fields
		});
	}
});

export const removeCondition = orgStaffMutation("coupons:write")({
	args: { conditionId: v.id("eligibilityConditions") },
	handler: async (ctx, args) => {
		const condition = await ctx.db.get(args.conditionId);
		if (!condition || condition.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Condition not found in this organization" });
		}
		await ctx.db.delete(args.conditionId);
	}
});
