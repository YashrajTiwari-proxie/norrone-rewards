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

describe("customers.internalRemove", () => {
	it("deletes the customer and every row referencing it, in every related table", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, shopId } = await seedOrgAndShop(t);

		const { customerId, otherCustomerId } = await t.run(async (ctx) => {
			const customerId = await ctx.db.insert("customers", {
				organizationId,
				shopId,
				externalId: "cust-1",
				totalSpend: 0,
				visitCount: 0
			});
			// A second, unrelated customer whose rows must survive the delete —
			// proves the cascade is scoped to the deleted customerId, not the shop/org.
			const otherCustomerId = await ctx.db.insert("customers", {
				organizationId,
				shopId,
				externalId: "cust-2",
				totalSpend: 0,
				visitCount: 0
			});

			await ctx.db.insert("pointLedger", { customerId, amount: 10, reason: "ACTION" });
			await ctx.db.insert("pointLedger", { customerId: otherCustomerId, amount: 10, reason: "ACTION" });

			const tierId = await ctx.db.insert("tiers", { organizationId, name: "Gold", level: 1, pointMultiplier: 2 });
			await ctx.db.insert("customerTier", { customerId, tierId, source: "MANUAL" });
			await ctx.db.insert("customerTier", { customerId: otherCustomerId, tierId, source: "MANUAL" });

			const planId = await ctx.db.insert("membershipPlans", { organizationId, name: "VIP", pointMultiplier: 1 });
			await ctx.db.insert("customerMemberships", {
				customerId,
				planId,
				status: "ACTIVE",
				startDate: Date.now(),
				expiryDate: Date.now() + 1000
			});
			await ctx.db.insert("customerMemberships", {
				customerId: otherCustomerId,
				planId,
				status: "ACTIVE",
				startDate: Date.now(),
				expiryDate: Date.now() + 1000
			});

			const rewardId = await ctx.db.insert("rewardDefinitions", { organizationId, name: "Free Coffee", memberOnly: false });
			await ctx.db.insert("customerRewards", { customerId, rewardId });
			await ctx.db.insert("customerRewards", { customerId: otherCustomerId, rewardId });

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
				expiresAt: Date.now() + 1000
			});
			await ctx.db.insert("couponInstances", {
				customerId: otherCustomerId,
				couponDefinitionId: couponDefId,
				code: "XYZ789",
				status: "ISSUED",
				expiresAt: Date.now() + 1000
			});

			return { customerId, otherCustomerId };
		});

		await t.mutation(internal.customers.internalRemove, { organizationId, customerId });

		await t.run(async (ctx) => {
			expect(await ctx.db.get(customerId)).toBeNull();

			for (const table of ["pointLedger", "customerTier", "customerMemberships", "customerRewards", "couponInstances"] as const) {
				const remaining = await ctx.db
					.query(table)
					.withIndex("by_customer", (q) => q.eq("customerId", customerId))
					.collect();
				expect(remaining).toEqual([]);

				// The other customer's rows in the same tables must be untouched.
				const otherRemaining = await ctx.db
					.query(table)
					.withIndex("by_customer", (q) => q.eq("customerId", otherCustomerId))
					.collect();
				expect(otherRemaining.length).toBe(1);
			}
		});
	});

	it("rejects deleting a customer that belongs to a different organization", async () => {
		const t = convexTest(schema, modules);
		const { organizationId, shopId } = await seedOrgAndShop(t);
		const otherOrgId = await t.run((ctx) => ctx.db.insert("organizations", { name: "Other Org" }));

		const customerId = await t.run((ctx) =>
			ctx.db.insert("customers", { organizationId, shopId, externalId: "cust-1", totalSpend: 0, visitCount: 0 })
		);

		await expect(t.mutation(internal.customers.internalRemove, { organizationId: otherOrgId, customerId })).rejects.toThrow();

		await t.run(async (ctx) => {
			expect(await ctx.db.get(customerId)).not.toBeNull();
		});
	});
});
