import { v, ConvexError } from "convex/values";
import { orgStaffQuery, orgStaffMutation, assertShopInOrg, assertNonNegative } from "./lib/authz";

const metricLabel: Record<string, string> = {
	SPEND: "spend",
	VISITS: "visits",
	POINTS: "points",
	TIER_LEVEL: "tier level",
	MEMBERSHIP_ACTIVE: "active membership"
};
const opLabel: Record<string, string> = { GTE: "≥", LTE: "≤", EQ: "=" };

export const list = orgStaffQuery("tiers:read")({
	args: {},
	handler: async (ctx) => {
		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const shopNameById = new Map(shops.map((s) => [s._id, s.name]));

		const tiers = await ctx.db
			.query("tiers")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		tiers.sort((a, b) => a.level - b.level);

		return await Promise.all(
			tiers.map(async (tier) => {
				const conditions = await ctx.db
					.query("eligibilityConditions")
					.withIndex("by_target", (q) => q.eq("targetType", "TIER").eq("targetId", tier._id))
					.collect();
				const benefits = await ctx.db
					.query("grantedBenefits")
					.withIndex("by_source", (q) => q.eq("sourceType", "TIER").eq("sourceId", tier._id))
					.collect();
				const holders = await ctx.db
					.query("customerTier")
					.withIndex("by_tier", (q) => q.eq("tierId", tier._id))
					.collect();

				const conditionSummary =
					conditions.map((c) => `${metricLabel[c.metric] ?? c.metric} ${opLabel[c.operator] ?? c.operator} ${c.value}`).join(", ") ||
					"No conditions set — will never auto-grant";

				return {
					...tier,
					scopeName: tier.shopId ? (shopNameById.get(tier.shopId) ?? "This shop") : "All shops",
					conditionSummary,
					customers: holders.length,
					conditions,
					benefits
				};
			})
		);
	}
});

export const create = orgStaffMutation("tiers:write")({
	args: {
		name: v.string(),
		level: v.number(),
		pointMultiplier: v.number(),
		shopId: v.optional(v.id("shops"))
	},
	handler: async (ctx, args) => {
		assertNonNegative(args.level, "level");
		assertNonNegative(args.pointMultiplier, "pointMultiplier");
		await assertShopInOrg(ctx, args.shopId, ctx.organizationId);
		await ctx.db.insert("tiers", { organizationId: ctx.organizationId, ...args });
	}
});

export const update = orgStaffMutation("tiers:write")({
	args: {
		tierId: v.id("tiers"),
		name: v.string(),
		level: v.number(),
		pointMultiplier: v.number(),
		shopId: v.optional(v.id("shops"))
	},
	handler: async (ctx, args) => {
		const { tierId, ...fields } = args;
		const tier = await ctx.db.get(tierId);
		assertNonNegative(fields.level, "level");
		assertNonNegative(fields.pointMultiplier, "pointMultiplier");
		if (!tier || tier.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Tier not found in this organization" });
		}
		await assertShopInOrg(ctx, fields.shopId, ctx.organizationId);
		await ctx.db.patch(tierId, fields);
	}
});

export const remove = orgStaffMutation("tiers:write")({
	args: { tierId: v.id("tiers") },
	handler: async (ctx, args) => {
		const tier = await ctx.db.get(args.tierId);
		if (!tier || tier.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Tier not found in this organization" });
		}
		await ctx.db.delete(args.tierId);
	}
});

export const addCondition = orgStaffMutation("tiers:write")({
	args: {
		tierId: v.id("tiers"),
		metric: v.union(v.literal("SPEND"), v.literal("VISITS"), v.literal("POINTS"), v.literal("TIER_LEVEL"), v.literal("MEMBERSHIP_ACTIVE")),
		operator: v.union(v.literal("GTE"), v.literal("LTE"), v.literal("EQ")),
		value: v.number(),
		period: v.union(v.literal("LIFETIME"), v.literal("MONTHLY"), v.literal("YEARLY"))
	},
	handler: async (ctx, args) => {
		const { tierId, ...fields } = args;
		const tier = await ctx.db.get(tierId);
		if (!tier || tier.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Tier not found in this organization" });
		}
		await ctx.db.insert("eligibilityConditions", {
			organizationId: ctx.organizationId,
			targetType: "TIER",
			targetId: tierId,
			...fields
		});
	}
});

export const removeCondition = orgStaffMutation("tiers:write")({
	args: { conditionId: v.id("eligibilityConditions") },
	handler: async (ctx, args) => {
		const condition = await ctx.db.get(args.conditionId);
		if (!condition || condition.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Condition not found in this organization" });
		}
		await ctx.db.delete(args.conditionId);
	}
});

export const addBenefit = orgStaffMutation("tiers:write")({
	args: { tierId: v.id("tiers"), benefitType: v.literal("POINTS"), pointsAmount: v.number() },
	handler: async (ctx, args) => {
		const tier = await ctx.db.get(args.tierId);
		if (!tier || tier.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Tier not found in this organization" });
		}
		await ctx.db.insert("grantedBenefits", {
			organizationId: ctx.organizationId,
			sourceType: "TIER",
			sourceId: args.tierId,
			benefitType: args.benefitType,
			pointsAmount: args.pointsAmount
		});
	}
});

export const removeBenefit = orgStaffMutation("tiers:write")({
	args: { benefitId: v.id("grantedBenefits") },
	handler: async (ctx, args) => {
		const benefit = await ctx.db.get(args.benefitId);
		if (!benefit || benefit.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Benefit not found in this organization" });
		}
		await ctx.db.delete(args.benefitId);
	}
});
