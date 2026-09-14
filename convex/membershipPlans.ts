import { v, ConvexError } from "convex/values";
import { orgStaffQuery, orgStaffMutation, assertShopInOrg, assertPositive } from "./lib/authz";

export const list = orgStaffQuery("membershipPlans:read")({
	args: {},
	handler: async (ctx) => {
		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const shopNameById = new Map(shops.map((s) => [s._id, s.name]));

		const plans = await ctx.db
			.query("membershipPlans")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		plans.sort((a, b) => a.name.localeCompare(b.name));

		const now = Date.now();
		return await Promise.all(
			plans.map(async (plan) => {
				const benefits = await ctx.db
					.query("grantedBenefits")
					.withIndex("by_source", (q) => q.eq("sourceType", "MEMBERSHIP_PLAN").eq("sourceId", plan._id))
					.collect();
				const memberships = await ctx.db
					.query("customerMemberships")
					.filter((q) => q.eq(q.field("planId"), plan._id))
					.collect();
				const activeMembers = memberships.filter((m) => m.status === "ACTIVE" && m.expiryDate > now).length;

				return { ...plan, scopeName: plan.shopId ? (shopNameById.get(plan.shopId) ?? "This shop") : "All shops", activeMembers, benefits };
			})
		);
	}
});

const planFields = {
	name: v.string(),
	price: v.number(),
	durationDays: v.number(),
	pointMultiplier: v.number(),
	shopId: v.optional(v.id("shops"))
};

export const create = orgStaffMutation("membershipPlans:write")({
	args: planFields,
	handler: async (ctx, args) => {
		assertPositive(args.price, "price");
		assertPositive(args.durationDays, "durationDays");
		await assertShopInOrg(ctx, args.shopId, ctx.organizationId);
		await ctx.db.insert("membershipPlans", { organizationId: ctx.organizationId, ...args });
	}
});

export const update = orgStaffMutation("membershipPlans:write")({
	args: { planId: v.id("membershipPlans"), ...planFields },
	handler: async (ctx, args) => {
		const { planId, ...fields } = args;
		assertPositive(fields.price, "price");
		assertPositive(fields.durationDays, "durationDays");
		const plan = await ctx.db.get(planId);
		if (!plan || plan.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Membership plan not found in this organization" });
		}
		await assertShopInOrg(ctx, fields.shopId, ctx.organizationId);
		await ctx.db.patch(planId, fields);
	}
});

export const remove = orgStaffMutation("membershipPlans:write")({
	args: { planId: v.id("membershipPlans") },
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan || plan.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Membership plan not found in this organization" });
		}
		await ctx.db.delete(args.planId);
	}
});

export const addBenefit = orgStaffMutation("membershipPlans:write")({
	args: { planId: v.id("membershipPlans"), benefitType: v.literal("POINTS"), pointsAmount: v.number() },
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan || plan.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Membership plan not found in this organization" });
		}
		await ctx.db.insert("grantedBenefits", {
			organizationId: ctx.organizationId,
			sourceType: "MEMBERSHIP_PLAN",
			sourceId: args.planId,
			benefitType: args.benefitType,
			pointsAmount: args.pointsAmount
		});
	}
});

export const removeBenefit = orgStaffMutation("membershipPlans:write")({
	args: { benefitId: v.id("grantedBenefits") },
	handler: async (ctx, args) => {
		const benefit = await ctx.db.get(args.benefitId);
		if (!benefit || benefit.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Benefit not found in this organization" });
		}
		await ctx.db.delete(args.benefitId);
	}
});
