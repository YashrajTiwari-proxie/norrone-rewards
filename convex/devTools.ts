import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { generateApiKey, hashApiKey } from "./lib/apiKeys";
import { generateCouponCode } from "./lib/loyaltyEngine";

/**
 * One-off fixture seeding for exercising the /v1/... HTTP API end-to-end
 * before the dashboard is wired up to create orgs/shops/API keys itself
 * (that's the self-serve-signup + API-key-management UI, still pending —
 * see the migration's own pending-tasks list). Run via
 * `npx convex run devTools:seedApiTestFixtures`. Not reachable from any
 * client — internalMutation only.
 */
export const seedApiTestFixtures = internalMutation({
	args: {},
	handler: async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", { name: "Convex Test Org" });
		const shopId = await ctx.db.insert("shops", { organizationId, name: "Convex Test Shop" });

		const plaintextKey = generateApiKey("secret");
		await ctx.db.insert("apiKeys", {
			organizationId,
			shopId: undefined,
			hashedKey: await hashApiKey(plaintextKey),
			type: "secret",
			revoked: false
		});

		const tierId = await ctx.db.insert("tiers", {
			organizationId,
			name: "Gold",
			level: 1,
			pointMultiplier: 2
		});
		await ctx.db.insert("eligibilityConditions", {
			organizationId,
			targetType: "TIER",
			targetId: tierId,
			metric: "SPEND",
			operator: "GTE",
			value: 100,
			period: "LIFETIME"
		});

		await ctx.db.insert("pointRules", {
			organizationId,
			action: "PURCHASE",
			pointsPerUnit: 1,
			memberOnly: false
		});

		const planId = await ctx.db.insert("membershipPlans", {
			organizationId,
			name: "VIP Monthly",
			price: 9.99,
			durationDays: 30,
			pointMultiplier: 1.5
		});

		return { organizationId, shopId, tierId, planId, plaintextKey };
	}
});

/** Deletes every couponInstances row with a given code — cleanup for a bad manual seed, not a real feature. */
export const deleteCouponInstancesByCode = internalMutation({
	args: { code: v.string() },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("couponInstances")
			.withIndex("by_code", (q) => q.eq("code", args.code))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
		return { deleted: rows.length };
	}
});

/** Seeds one ISSUED coupon instance directly, for exercising POST /v1/coupons/:code/redeem without needing evaluate_and_grant to fire first. */
export const seedCouponForRedeem = internalMutation({
	args: { organizationId: v.id("organizations"), customerId: v.id("customers"), code: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const couponDefinitionId = await ctx.db.insert("couponDefinitions", {
			organizationId: args.organizationId,
			name: "Test Coupon",
			discountValue: 10,
			discountType: "PERCENTAGE",
			validityDays: 30,
			memberOnly: false
		});
		// Caller-supplied code, or a fresh unique one per call — this is a
		// test-only fixture (unlike real coupon issuance, which always goes
		// through generateCouponCode()'s collision-checked path), so it's
		// on the caller not to hardcode a literal across repeated runs.
		const code = args.code ?? await generateCouponCode(ctx);
		await ctx.db.insert("couponInstances", {
			customerId: args.customerId,
			couponDefinitionId,
			code,
			status: "ISSUED",
			expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
		});
		return { code };
	}
});

/** Generates a secret API key for an existing organization — used to seed test customers via the /v1 API. */
export const createApiKeyForOrg = internalMutation({
	args: { organizationId: v.id("organizations") },
	handler: async (ctx, args) => {
		const plaintextKey = generateApiKey("secret");
		await ctx.db.insert("apiKeys", {
			organizationId: args.organizationId,
			shopId: undefined,
			hashedKey: await hashApiKey(plaintextKey),
			type: "secret",
			revoked: false
		});
		return { plaintextKey };
	}
});

/** Deletes a grantedBenefits row by id — cleanup for a bad manual test, not a real feature. */
export const deleteGrantedBenefit = internalMutation({
	args: { benefitId: v.id("grantedBenefits") },
	handler: async (ctx, args) => {
		await ctx.db.delete(args.benefitId);
	}
});
