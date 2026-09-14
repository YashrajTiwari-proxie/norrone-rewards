import { convexTest } from "convex-test";
import { describe, expect, it, vi, afterEach } from "vitest";
import schema from "../schema";
import {
	updateCustomerStats,
	evaluateAndGrant,
	applicableMultiplier,
	isActiveMember,
	redeemCoupon,
	enrollMembership,
	generateCouponCode
} from "./loyaltyEngine";

// convex-test spins up an in-memory backend against our real schema (real
// indexes, real transactional `run` semantics) — no components are
// registered here (authz-tenant-kit, betterAuth), which is fine: none of
// loyaltyEngine.ts's functions touch either, only ctx.db against our own
// tables. That's exactly the seam these tests exercise.
const modules = import.meta.glob("../**/*.ts");

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedOrgShopCustomer(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", { name: "Test Org" });
		const shopId = await ctx.db.insert("shops", { organizationId, name: "Test Shop" });
		const customerId = await ctx.db.insert("customers", {
			organizationId,
			shopId,
			externalId: "cust-1",
			totalSpend: 0,
			visitCount: 0
		});
		return { organizationId, shopId, customerId };
	});
}

describe("updateCustomerStats", () => {
	it("applies spend/visit deltas", async () => {
		const t = convexTest(schema, modules);
		const { customerId } = await seedOrgShopCustomer(t);

		await t.run((ctx) => updateCustomerStats(ctx, { customerId, deltaSpend: 100, deltaVisits: 2 }));

		const customer = await t.run((ctx) => ctx.db.get(customerId));
		expect(customer?.totalSpend).toBe(100);
		expect(customer?.visitCount).toBe(2);
	});

	it("awards ACTION points via the matching point rule, scaled by the multiplier", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run((ctx) => ctx.db.insert("pointRules", { organizationId, action: "PURCHASE", pointsPerUnit: 10, memberOnly: false }));

		const result = await t.run((ctx) => updateCustomerStats(ctx, { customerId, action: "PURCHASE" }));

		expect(result).not.toHaveProperty("idempotent");
		const ledger = await t.run((ctx) =>
			ctx.db
				.query("pointLedger")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		);
		expect(ledger).toHaveLength(1);
		expect(ledger[0].amount).toBe(10);
		expect(ledger[0].reason).toBe("ACTION");
	});

	it("prefers a shop-specific point rule over an org-wide one", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, shopId, customerId } = await seedOrgShopCustomer(t);
		await t.run(async (ctx) => {
			await ctx.db.insert("pointRules", { organizationId, action: "PURCHASE", pointsPerUnit: 1, memberOnly: false });
			await ctx.db.insert("pointRules", { organizationId, shopId, action: "PURCHASE", pointsPerUnit: 5, memberOnly: false });
		});

		await t.run((ctx) => updateCustomerStats(ctx, { customerId, action: "PURCHASE" }));

		const ledger = await t.run((ctx) =>
			ctx.db
				.query("pointLedger")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		);
		expect(ledger[0].amount).toBe(5);
	});

	it("skips a member-only rule for a non-member", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run((ctx) => ctx.db.insert("pointRules", { organizationId, action: "PURCHASE", pointsPerUnit: 10, memberOnly: true }));

		await t.run((ctx) => updateCustomerStats(ctx, { customerId, action: "PURCHASE" }));

		const ledger = await t.run((ctx) =>
			ctx.db
				.query("pointLedger")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		);
		expect(ledger).toHaveLength(0);
	});

	it("is idempotent: a replayed idempotency key does not double-apply", async () => {
		const t = convexTest(schema, modules);
		const { customerId } = await seedOrgShopCustomer(t);

		const first = await t.run((ctx) =>
			updateCustomerStats(ctx, { customerId, deltaSpend: 50, idempotencyKey: "order-1" })
		);
		const second = await t.run((ctx) =>
			updateCustomerStats(ctx, { customerId, deltaSpend: 50, idempotencyKey: "order-1" })
		);

		expect(first).not.toHaveProperty("idempotent");
		expect(second).toEqual({ idempotent: true });
		const customer = await t.run((ctx) => ctx.db.get(customerId));
		expect(customer?.totalSpend).toBe(50);
	});

	it("throws for an unknown customer", async () => {
		const t = convexTest(schema, modules);
		const { customerId } = await seedOrgShopCustomer(t);
		await t.run((ctx) => ctx.db.delete(customerId));

		await expect(t.run((ctx) => updateCustomerStats(ctx, { customerId }))).rejects.toThrow("Customer not found");
	});
});

describe("evaluateAndGrant", () => {
	it("never auto-grants a tier with zero eligibility conditions (vacuous-grant guard)", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run((ctx) => ctx.db.insert("tiers", { organizationId, name: "Gold", level: 1, pointMultiplier: 2 }));

		const result = await t.run((ctx) => evaluateAndGrant(ctx, customerId));

		expect(result.tiers).toHaveLength(0);
	});

	it("auto-grants a tier exactly when its condition is met, and not before", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		const tierId = await t.run(async (ctx) => {
			const tierId = await ctx.db.insert("tiers", { organizationId, name: "Gold", level: 1, pointMultiplier: 2 });
			await ctx.db.insert("eligibilityConditions", {
				organizationId,
				targetType: "TIER",
				targetId: tierId,
				metric: "SPEND",
				operator: "GTE",
				value: 100,
				period: "LIFETIME"
			});
			return tierId;
		});

		const below = await t.run((ctx) => evaluateAndGrant(ctx, customerId));
		expect(below.tiers).toHaveLength(0);

		await t.run((ctx) => ctx.db.patch(customerId, { totalSpend: 100 }));
		const atThreshold = await t.run((ctx) => evaluateAndGrant(ctx, customerId));
		expect(atThreshold.tiers).toEqual([{ id: tierId, name: "Gold" }]);

		// Already held — must not grant (and therefore not re-apply benefits) again.
		const again = await t.run((ctx) => evaluateAndGrant(ctx, customerId));
		expect(again.tiers).toHaveLength(0);
	});

	it("applies a tier's granted POINTS benefit exactly once, on grant", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run(async (ctx) => {
			await ctx.db.patch(customerId, { totalSpend: 100 });
			const tierId = await ctx.db.insert("tiers", { organizationId, name: "Gold", level: 1, pointMultiplier: 2 });
			await ctx.db.insert("eligibilityConditions", {
				organizationId,
				targetType: "TIER",
				targetId: tierId,
				metric: "SPEND",
				operator: "GTE",
				value: 100,
				period: "LIFETIME"
			});
			await ctx.db.insert("grantedBenefits", {
				organizationId,
				sourceType: "TIER",
				sourceId: tierId,
				benefitType: "POINTS",
				pointsAmount: 25
			});
		});

		await t.run((ctx) => evaluateAndGrant(ctx, customerId));
		await t.run((ctx) => evaluateAndGrant(ctx, customerId)); // re-run: must not double-apply

		const ledger = await t.run((ctx) =>
			ctx.db
				.query("pointLedger")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		);
		expect(ledger).toHaveLength(1);
		expect(ledger[0].amount).toBe(25);
	});

	it("does not grant a reward scoped to a different shop", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run(async (ctx) => {
			const otherShopId = await ctx.db.insert("shops", { organizationId, name: "Other Shop" });
			const rewardId = await ctx.db.insert("rewardDefinitions", {
				organizationId,
				shopId: otherShopId,
				name: "Free Dessert",
				memberOnly: false
			});
			await ctx.db.insert("eligibilityConditions", {
				organizationId,
				targetType: "REWARD",
				targetId: rewardId,
				metric: "VISITS",
				operator: "GTE",
				value: 1,
				period: "LIFETIME"
			});
			await ctx.db.patch(customerId, { visitCount: 5 });
		});

		const result = await t.run((ctx) => evaluateAndGrant(ctx, customerId));
		expect(result.rewards).toHaveLength(0);
	});

	it("does not grant a member-only coupon to a non-member", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run(async (ctx) => {
			const couponDefId = await ctx.db.insert("couponDefinitions", {
				organizationId,
				name: "VIP 10% Off",
				discountValue: 10,
				discountType: "PERCENTAGE",
				validityDays: 30,
				memberOnly: true
			});
			await ctx.db.insert("eligibilityConditions", {
				organizationId,
				targetType: "COUPON",
				targetId: couponDefId,
				metric: "VISITS",
				operator: "GTE",
				value: 0,
				period: "LIFETIME"
			});
		});

		const result = await t.run((ctx) => evaluateAndGrant(ctx, customerId));
		expect(result.coupons).toHaveLength(0);
	});
});

describe("applicableMultiplier / isActiveMember", () => {
	it("defaults to 1.0 with no tier or membership", async () => {
		const t = convexTest(schema, modules);
		const { customerId } = await seedOrgShopCustomer(t);
		const multiplier = await t.run((ctx) => applicableMultiplier(ctx, customerId));
		expect(multiplier).toBe(1.0);
	});

	it("takes the highest of tier and membership multipliers, never stacking", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run(async (ctx) => {
			const tierId = await ctx.db.insert("tiers", { organizationId, name: "Silver", level: 1, pointMultiplier: 1.5 });
			await ctx.db.insert("customerTier", { customerId, tierId, source: "MANUAL" });
			const planId = await ctx.db.insert("membershipPlans", {
				organizationId,
				name: "VIP",
				price: 10,
				durationDays: 30,
				pointMultiplier: 3
			});
			await ctx.db.insert("customerMemberships", {
				customerId,
				planId,
				status: "ACTIVE",
				startDate: Date.now(),
				expiryDate: Date.now() + DAY_MS
			});
		});

		expect(await t.run((ctx) => applicableMultiplier(ctx, customerId))).toBe(3);
	});

	it("isActiveMember is false once expiryDate has passed, even though applicableMultiplier's membership leg only checks status", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await t.run(async (ctx) => {
			const planId = await ctx.db.insert("membershipPlans", {
				organizationId,
				name: "VIP",
				price: 10,
				durationDays: 30,
				pointMultiplier: 5
			});
			await ctx.db.insert("customerMemberships", {
				customerId,
				planId,
				status: "ACTIVE",
				startDate: Date.now() - 2 * DAY_MS,
				expiryDate: Date.now() - DAY_MS // already expired
			});
		});

		// Documented asymmetry (see loyaltyEngine.ts's own comment): expired
		// membership is NOT "active" for gating purposes...
		expect(await t.run((ctx) => isActiveMember(ctx, customerId))).toBe(false);
		// ...but its multiplier is still picked up, since that leg never
		// checks expiry, ported as-is from the original Postgres function.
		expect(await t.run((ctx) => applicableMultiplier(ctx, customerId))).toBe(5);
	});
});

describe("enrollMembership", () => {
	it("starts an ACTIVE membership and is idempotent on replay", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		const planId = await t.run((ctx) =>
			ctx.db.insert("membershipPlans", { organizationId, name: "VIP", price: 10, durationDays: 30, pointMultiplier: 1 })
		);

		const first = await t.run((ctx) => enrollMembership(ctx, { customerId, planId, idempotencyKey: "enroll-1" }));
		const second = await t.run((ctx) => enrollMembership(ctx, { customerId, planId, idempotencyKey: "enroll-1" }));

		expect(first).not.toHaveProperty("idempotent");
		expect(second).toEqual({ idempotent: true });
		const memberships = await t.run((ctx) =>
			ctx.db
				.query("customerMemberships")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		);
		expect(memberships).toHaveLength(1);
		expect(memberships[0].status).toBe("ACTIVE");
	});
});

describe("redeemCoupon", () => {
	async function seedCoupon(
		t: ReturnType<typeof convexTest>,
		organizationId: Awaited<ReturnType<typeof seedOrgShopCustomer>>["organizationId"],
		customerId: Awaited<ReturnType<typeof seedOrgShopCustomer>>["customerId"],
		overrides: Partial<{ status: "ISSUED" | "REDEEMED" | "EXPIRED" | "CANCELLED"; expiresAt: number }> = {}
	) {
		return await t.run(async (ctx) => {
			const couponDefId = await ctx.db.insert("couponDefinitions", {
				organizationId,
				name: "10% Off",
				discountValue: 10,
				discountType: "PERCENTAGE",
				validityDays: 30,
				memberOnly: false
			});
			const couponInstanceId = await ctx.db.insert("couponInstances", {
				customerId,
				couponDefinitionId: couponDefId,
				code: "TESTCODE1",
				status: overrides.status ?? "ISSUED",
				expiresAt: overrides.expiresAt ?? Date.now() + DAY_MS
			});
			return couponInstanceId;
		});
	}

	it("redeems a valid, unexpired coupon", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await seedCoupon(t, organizationId, customerId);

		const result = await t.run((ctx) => redeemCoupon(ctx, { code: "TESTCODE1", organizationId }));
		expect(result).toMatchObject({ ok: true });
	});

	it("rejects a second redeem of the same coupon", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await seedCoupon(t, organizationId, customerId);

		await t.run((ctx) => redeemCoupon(ctx, { code: "TESTCODE1", organizationId }));
		const second = await t.run((ctx) => redeemCoupon(ctx, { code: "TESTCODE1", organizationId }));
		expect(second).toEqual({ error: "ALREADY_REDEEMED" });
	});

	it("returns NOT_FOUND for an unknown code", async () => {
		const t = convexTest(schema, modules);
		const { organizationId } = await seedOrgShopCustomer(t);
		const result = await t.run((ctx) => redeemCoupon(ctx, { code: "NOPE", organizationId }));
		expect(result).toEqual({ error: "NOT_FOUND" });
	});

	it("lazily flips an expired coupon to EXPIRED and refuses redemption", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		const couponInstanceId = await seedCoupon(t, organizationId, customerId, { expiresAt: Date.now() - 1 });

		const result = await t.run((ctx) => redeemCoupon(ctx, { code: "TESTCODE1", organizationId }));
		expect(result).toEqual({ error: "EXPIRED" });

		const coupon = await t.run((ctx) => ctx.db.get(couponInstanceId));
		expect(coupon?.status).toBe("EXPIRED");
	});

	it("does not let one organization's API key redeem another organization's coupon (tenant isolation)", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await seedCoupon(t, organizationId, customerId);
		const otherOrgId = await t.run((ctx) => ctx.db.insert("organizations", { name: "Other Org" }));

		const result = await t.run((ctx) => redeemCoupon(ctx, { code: "TESTCODE1", organizationId: otherOrgId }));
		// Same NOT_FOUND shape a real cross-tenant probe would see — never
		// distinguishable from "this code doesn't exist at all".
		expect(result).toEqual({ error: "NOT_FOUND" });
	});

	it("refuses to redeem a CANCELLED coupon", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		await seedCoupon(t, organizationId, customerId, { status: "CANCELLED" });

		const result = await t.run((ctx) => redeemCoupon(ctx, { code: "TESTCODE1", organizationId }));
		expect(result).toEqual({ error: "NOT_REDEEMABLE" });
	});
});

describe("generateCouponCode", () => {
	const originalRandom = Math.random;
	afterEach(() => {
		Math.random = originalRandom;
	});

	it("retries on a collision instead of returning a duplicate code", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, customerId } = await seedOrgShopCustomer(t);
		const couponDefId = await t.run((ctx) =>
			ctx.db.insert("couponDefinitions", {
				organizationId,
				name: "Test",
				discountValue: 1,
				discountType: "FIXED",
				validityDays: 1,
				memberOnly: false
			})
		);
		await t.run((ctx) =>
			ctx.db.insert("couponInstances", {
				customerId,
				couponDefinitionId: couponDefId,
				code: "AAAAAAAAAA",
				status: "ISSUED",
				expiresAt: Date.now() + DAY_MS
			})
		);

		// Math.random() always 0 -> randomCouponCode() always produces
		// "AAAAAAAAAA", the code that already exists, on every attempt.
		Math.random = () => 0;
		await expect(t.run((ctx) => generateCouponCode(ctx))).rejects.toThrow(
			"Failed to generate a unique coupon code after 5 attempts"
		);
	});
});
