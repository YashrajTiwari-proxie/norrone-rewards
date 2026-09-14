import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";

const modules = import.meta.glob("./**/*.ts");

async function seedOrgAndShop(t: ReturnType<typeof convexTest>) {
	return await t.run(async (ctx) => {
		const organizationId = await ctx.db.insert("organizations", { name: "Test Org" });
		const shopId = await ctx.db.insert("shops", { organizationId, name: "Test Shop" });
		return { organizationId, shopId };
	});
}

describe("apiInternal.createCustomer", () => {
	it("creates a customer and returns its serialized view", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, shopId } = await seedOrgAndShop(t);

		const result = await t.mutation(internal.apiInternal.createCustomer, {
			organizationId,
			shopId,
			externalId: "cust-1",
			name: "Ada"
		});

		expect(result.conflict).toBe(false);
		if (!result.conflict) {
			expect(result.view.externalId).toBe("cust-1");
			expect(result.view.pointBalance).toBe(0);
			expect(result.view.isMember).toBe(false);
		}
	});

	it("reports a conflict for a duplicate externalId within the same shop", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, shopId } = await seedOrgAndShop(t);

		await t.mutation(internal.apiInternal.createCustomer, { organizationId, shopId, externalId: "cust-1" });
		const second = await t.mutation(internal.apiInternal.createCustomer, {
			organizationId,
			shopId,
			externalId: "cust-1"
		});

		expect(second.conflict).toBe(true);
	});

	it("allows the same externalId in two different shops", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, shopId } = await seedOrgAndShop(t);
		const otherShopId = await t.run((ctx) => ctx.db.insert("shops", { organizationId, name: "Other Shop" }));

		await t.mutation(internal.apiInternal.createCustomer, { organizationId, shopId, externalId: "cust-1" });
		const second = await t.mutation(internal.apiInternal.createCustomer, {
			organizationId,
			shopId: otherShopId,
			externalId: "cust-1"
		});

		expect(second.conflict).toBe(false);
	});
});

describe("apiInternal.getCustomerView", () => {
	it("aggregates point balance, tier, membership, rewards, and coupons", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, shopId } = await seedOrgAndShop(t);

		const customerId = await t.run(async (ctx) => {
			const customerId = await ctx.db.insert("customers", {
				organizationId,
				shopId,
				externalId: "cust-1",
				totalSpend: 0,
				visitCount: 0
			});
			await ctx.db.insert("pointLedger", { customerId, amount: 30, reason: "ACTION" });
			await ctx.db.insert("pointLedger", { customerId, amount: -5, reason: "REVERSAL" });

			const tierId = await ctx.db.insert("tiers", { organizationId, name: "Gold", level: 1, pointMultiplier: 2 });
			await ctx.db.insert("customerTier", { customerId, tierId, source: "MANUAL" });

			const planId = await ctx.db.insert("membershipPlans", {
				organizationId,
				name: "VIP",
				price: 10,
				durationDays: 30,
				pointMultiplier: 1
			});
			await ctx.db.insert("customerMemberships", {
				customerId,
				planId,
				status: "ACTIVE",
				startDate: Date.now(),
				expiryDate: Date.now() + 30 * 24 * 60 * 60 * 1000
			});

			const rewardId = await ctx.db.insert("rewardDefinitions", { organizationId, name: "Free Coffee", memberOnly: false });
			await ctx.db.insert("customerRewards", { customerId, rewardId });

			const couponDefId = await ctx.db.insert("couponDefinitions", {
				organizationId,
				name: "10% Off",
				discountValue: 10,
				discountType: "PERCENTAGE",
				validityDays: 30,
				memberOnly: false
			});
			await ctx.db.insert("couponInstances", {
				customerId,
				couponDefinitionId: couponDefId,
				code: "ABC123",
				status: "ISSUED",
				expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
			});

			return customerId;
		});

		const view = await t.query(internal.apiInternal.getCustomerByExternalId, { shopId, externalId: "cust-1" });
		expect(view?._id).toBe(customerId);

		const serialized = await t.query(internal.apiInternal.getCustomerView, { shopId, externalId: "cust-1" });
		expect(serialized).not.toBeNull();
		expect(serialized!.pointBalance).toBe(25);
		expect(serialized!.tier).toEqual({ name: "Gold", level: 1 });
		expect(serialized!.isMember).toBe(true);
		expect(serialized!.membership?.planName).toBe("VIP");
		expect(serialized!.rewards).toEqual([{ name: "Free Coffee", grantedAt: expect.any(Number) }]);
		expect(serialized!.coupons).toEqual([{ code: "ABC123", status: "ISSUED", expiresAt: expect.any(Number) }]);
	});

	it("returns null for a customer that doesn't exist in the given shop", async () => {
		const t = convexTest(schema, modules);
		const { shopId } = await seedOrgAndShop(t);
		const view = await t.query(internal.apiInternal.getCustomerView, { shopId, externalId: "nope" });
		expect(view).toBeNull();
	});
});
