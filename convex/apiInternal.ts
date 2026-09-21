import { internalQuery, internalMutation, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isActiveMember } from "./lib/loyaltyEngine";

/**
 * Internal query/mutation layer backing the public /v1/... HTTP API
 * (convex/http.ts). httpActions have no direct ctx.db — every DB
 * operation the API needs goes through one of these via
 * ctx.runQuery/ctx.runMutation, mirroring what
 * src/lib/server/{apiAuth,shops,customers,customerView,offers}.ts did
 * against Supabase.
 */

export const resolveApiKey = internalQuery({
	args: { hashedKey: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("apiKeys")
			.withIndex("by_hashed_key", (q) => q.eq("hashedKey", args.hashedKey))
			.unique();
	}
});

export const getShopInScope = internalQuery({
	args: { shopId: v.id("shops"), organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const shop = await ctx.db.get(args.shopId);
		if (!shop || shop.organizationId !== args.organizationId) return null;
		return shop;
	}
});

async function serializeCustomer(ctx: QueryCtx, customer: Doc<"customers">) {
	const ledgerRows = await ctx.db
		.query("pointLedger")
		.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
		.collect();
	const pointBalance = ledgerRows.reduce((sum, row) => sum + row.amount, 0);

	const tierRow = await ctx.db
		.query("customerTier")
		.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
		.order("desc")
		.first();
	const tierDoc = tierRow ? await ctx.db.get(tierRow.tierId) : null;
	const tier = tierDoc ? { name: tierDoc.name, level: tierDoc.level } : null;

	const membershipRow = await ctx.db
		.query("customerMemberships")
		.withIndex("by_customer_and_status", (q) => q.eq("customerId", customer._id).eq("status", "ACTIVE"))
		.order("desc")
		.first();
	const planDoc =
		membershipRow && membershipRow.expiryDate > Date.now() ? await ctx.db.get(membershipRow.planId) : null;
	const membership = planDoc ? { planName: planDoc.name, expiresAt: membershipRow!.expiryDate } : null;

	const rewardRows = await ctx.db
		.query("customerRewards")
		.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
		.collect();
	const rewards = await Promise.all(
		rewardRows.map(async (row) => {
			const def = await ctx.db.get(row.rewardId);
			return { name: def?.name ?? "", grantedAt: row._creationTime };
		})
	);

	const couponRows = await ctx.db
		.query("couponInstances")
		.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
		.collect();
	const coupons = couponRows.map((row) => ({
		code: row.code,
		status: row.status,
		expiresAt: row.expiresAt
	}));

	return {
		externalId: customer.externalId,
		isMember: membership !== null,
		membership,
		tier,
		pointBalance,
		rewards,
		coupons
	};
}

export const getCustomerView = internalQuery({
	args: { shopId: v.id("shops"), externalId: v.string() },
	handler: async (ctx, args) => {
		const customer = await ctx.db
			.query("customers")
			.withIndex("by_shop_and_external_id", (q) => q.eq("shopId", args.shopId).eq("externalId", args.externalId))
			.unique();
		if (!customer) return null;
		return serializeCustomer(ctx, customer);
	}
});

export const createCustomer = internalMutation({
	args: {
		organizationId: v.id("organizations"),
		shopId: v.id("shops"),
		externalId: v.string(),
		name: v.optional(v.string()),
		phone: v.optional(v.string()),
		email: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("customers")
			.withIndex("by_shop_and_external_id", (q) => q.eq("shopId", args.shopId).eq("externalId", args.externalId))
			.unique();
		if (existing) {
			return { conflict: true as const };
		}
		const customerId = await ctx.db.insert("customers", {
			organizationId: args.organizationId,
			shopId: args.shopId,
			externalId: args.externalId,
			name: args.name,
			phone: args.phone,
			email: args.email,
			totalSpend: 0,
			visitCount: 0
		});
		const customer = (await ctx.db.get(customerId))!;
		return { conflict: false as const, view: await serializeCustomer(ctx, customer) };
	}
});

export const getCustomerByExternalId = internalQuery({
	args: { shopId: v.id("shops"), externalId: v.string() },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("customers")
			.withIndex("by_shop_and_external_id", (q) => q.eq("shopId", args.shopId).eq("externalId", args.externalId))
			.unique();
	}
});

/** GET .../points — full ledger history (newest first) plus the running balance, for a single customer. */
export const getCustomerPoints = internalQuery({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("pointLedger")
			.withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
			.collect();
		rows.sort((a, b) => b._creationTime - a._creationTime);
		return {
			balance: rows.reduce((sum, r) => sum + r.amount, 0),
			ledger: rows.map((r) => ({ amount: r.amount, reason: r.reason, note: r.referenceId, at: r._creationTime }))
		};
	}
});

export const getMembershipPlanInScope = internalQuery({
	args: { planId: v.id("membershipPlans"), organizationId: v.id("organizations"), shopId: v.id("shops") },
	handler: async (ctx, args) => {
		const plan = await ctx.db.get(args.planId);
		if (!plan || plan.organizationId !== args.organizationId) return null;
		if (plan.shopId != null && plan.shopId !== args.shopId) return null;
		return plan;
	}
});

function describeCondition(metric: string, operator: string, value: number): string {
	const op = operator === "GTE" ? "≥" : operator === "LTE" ? "≤" : "=";
	const label: Record<string, string> = {
		SPEND: "Total spend",
		VISITS: "Visits",
		POINTS: "Points",
		TIER_LEVEL: "Tier level",
		MEMBERSHIP_ACTIVE: "Active membership"
	};
	return `${label[metric] ?? metric} ${op} ${value}`;
}

export const getPersonalizedOffers = internalQuery({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) return null;

		const currentTierRow = await ctx.db
			.query("customerTier")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.order("desc")
			.first();
		const currentTierDoc = currentTierRow ? await ctx.db.get(currentTierRow.tierId) : null;
		const currentLevel = currentTierDoc?.level ?? 0;

		const orgTiers = await ctx.db
			.query("tiers")
			.withIndex("by_organization", (q) => q.eq("organizationId", customer.organizationId))
			.collect();
		const nextTierDoc = orgTiers
			.filter((t) => (t.shopId == null || t.shopId === customer.shopId) && t.level > currentLevel)
			.sort((a, b) => a.level - b.level)[0];

		let nextTier: { name: string; amountRemaining: number; metric: string } | null = null;
		if (nextTierDoc) {
			const conditions = await ctx.db
				.query("eligibilityConditions")
				.withIndex("by_target", (q) => q.eq("targetType", "TIER").eq("targetId", nextTierDoc._id))
				.collect();
			const condition = conditions.find((c) => c.operator === "GTE");
			if (condition) {
				let actual = 0;
				if (condition.metric === "SPEND") actual = customer.totalSpend;
				else if (condition.metric === "VISITS") actual = customer.visitCount;
				nextTier = {
					name: nextTierDoc.name,
					amountRemaining: Math.max(condition.value - actual, 0),
					metric: condition.metric
				};
			}
		}

		const heldCouponInstances = await ctx.db
			.query("couponInstances")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.collect();
		const heldCouponDefIds = new Set(heldCouponInstances.map((c) => c.couponDefinitionId));

		const orgCouponDefs = await ctx.db
			.query("couponDefinitions")
			.withIndex("by_organization", (q) => q.eq("organizationId", customer.organizationId))
			.collect();
		const availableCouponDefs = orgCouponDefs.filter(
			(def) => (def.shopId == null || def.shopId === customer.shopId) && !heldCouponDefIds.has(def._id)
		);
		const availableCoupons = await Promise.all(
			availableCouponDefs.map(async (def) => {
				const conditions = await ctx.db
					.query("eligibilityConditions")
					.withIndex("by_target", (q) => q.eq("targetType", "COUPON").eq("targetId", def._id))
					.collect();
				const condition = conditions[0];
				return {
					name: def.name,
					condition: condition ? describeCondition(condition.metric, condition.operator, condition.value) : null
				};
			})
		);

		const isMember = await isActiveMember(ctx, customer._id);
		const activeMembership = isMember
			? await ctx.db
					.query("customerMemberships")
					.withIndex("by_customer_and_status", (q) => q.eq("customerId", customer._id).eq("status", "ACTIVE"))
					.order("desc")
					.first()
			: null;

		const orgPlans = await ctx.db
			.query("membershipPlans")
			.withIndex("by_organization", (q) => q.eq("organizationId", customer.organizationId))
			.collect();
		const membershipPlansAvailable = orgPlans
			.filter(
				(plan) =>
					(plan.shopId == null || plan.shopId === customer.shopId) &&
					plan._id !== activeMembership?.planId
			)
			.map((plan) => ({ name: plan.name, price: plan.price }));

		return { nextTier, availableCoupons, membershipPlansAvailable };
	}
});

export const getPublicOffers = internalQuery({
	args: { organizationId: v.id("organizations"), shopId: v.id("shops") },
	handler: async (ctx, args) => {
		const inScope = (shopId: Id<"shops"> | undefined) => shopId == null || shopId === args.shopId;

		const membershipPlans = (
			await ctx.db
				.query("membershipPlans")
				.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
				.collect()
		)
			.filter((p) => inScope(p.shopId))
			.map((p) => ({ name: p.name, price: p.price }));

		const tiers = (
			await ctx.db
				.query("tiers")
				.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
				.collect()
		).filter((t) => inScope(t.shopId));

		const publicTiers = await Promise.all(
			tiers.map(async (tier) => {
				const conditions = await ctx.db
					.query("eligibilityConditions")
					.withIndex("by_target", (q) => q.eq("targetType", "TIER").eq("targetId", tier._id))
					.collect();
				const condition = conditions.find((c) => c.metric === "SPEND" && c.operator === "GTE");
				return { name: tier.name, threshold: condition?.value ?? null };
			})
		);

		const publicCoupons = (
			await ctx.db
				.query("couponDefinitions")
				.withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId))
				.collect()
		)
			.filter((c) => inScope(c.shopId) && !c.memberOnly)
			.map((c) => ({ name: c.name }));

		return { membershipPlans, publicTiers, publicCoupons };
	}
});
