import { v } from "convex/values";
import { orgStaffQuery, orgStaffMutation } from "./lib/authz";
import { isActiveMember } from "./lib/loyaltyEngine";
import { ConvexError } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Tables that reference a customer row — deleting a customer must not
 * leave any of these dangling. Every one has a `by_customer` index (see
 * schema.ts). Shared by the dashboard's `remove` and the public API's
 * `internalRemove` so both delete the exact same set of rows.
 */
async function deleteCustomerCascade(ctx: MutationCtx, customerId: Id<"customers">) {
	for (const table of ["pointLedger", "customerTier", "customerMemberships", "customerRewards", "couponInstances"] as const) {
		const rows = await ctx.db
			.query(table)
			.withIndex("by_customer", (q) => q.eq("customerId", customerId))
			.collect();
		for (const row of rows) await ctx.db.delete(row._id);
	}
	await ctx.db.delete(customerId);
}

const profileFields = {
	name: v.optional(v.string()),
	phone: v.optional(v.string()),
	email: v.optional(v.string())
};

async function updateProfileHandler(
	ctx: MutationCtx,
	organizationId: Id<"organizations">,
	customerId: Id<"customers">,
	fields: { name?: string; phone?: string; email?: string }
) {
	const customer = await ctx.db.get(customerId);
	if (!customer || customer.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found in this organization" });
	}
	await ctx.db.patch(customerId, fields);
}

async function removeCustomerHandler(ctx: MutationCtx, organizationId: Id<"organizations">, customerId: Id<"customers">) {
	const customer = await ctx.db.get(customerId);
	if (!customer || customer.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found in this organization" });
	}
	await deleteCustomerCascade(ctx, customerId);
}

export const update = orgStaffMutation("customers:write")({
	args: { customerId: v.id("customers"), ...profileFields },
	handler: async (ctx, args) => {
		const { customerId, ...fields } = args;
		await updateProfileHandler(ctx, ctx.organizationId, customerId, fields);
	}
});

export const internalUpdateProfile = internalMutation({
	args: { organizationId: v.id("organizations"), customerId: v.id("customers"), ...profileFields },
	handler: async (ctx, args) => {
		const { organizationId, customerId, ...fields } = args;
		await updateProfileHandler(ctx, organizationId, customerId, fields);
	}
});

export const remove = orgStaffMutation("customers:write")({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => removeCustomerHandler(ctx, ctx.organizationId, args.customerId)
});

export const internalRemove = internalMutation({
	args: { organizationId: v.id("organizations"), customerId: v.id("customers") },
	handler: async (ctx, args) => removeCustomerHandler(ctx, args.organizationId, args.customerId)
});

const PAGE_SIZE = 8;

export const list = orgStaffQuery("customers:read")({
	args: {
		shopId: v.optional(v.id("shops")),
		search: v.optional(v.string()),
		tierFilter: v.optional(v.string()),
		page: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const shops = await ctx.db
			.query("shops")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const shopNameById = new Map(shops.map((s) => [s._id, s.name]));

		const tiers = await ctx.db
			.query("tiers")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();

		let customers = await ctx.db
			.query("customers")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		if (args.shopId) customers = customers.filter((c) => c.shopId === args.shopId);
		if (args.search) {
			const needle = args.search.trim().toLowerCase();
			customers = customers.filter(
				(c) => c.name?.toLowerCase().includes(needle) || c.externalId.toLowerCase().includes(needle)
			);
		}
		customers.sort((a, b) => b._creationTime - a._creationTime);

		const withTier = await Promise.all(
			customers.map(async (c) => {
				const tierRow = await ctx.db
					.query("customerTier")
					.withIndex("by_customer", (q) => q.eq("customerId", c._id))
					.order("desc")
					.first();
				const tier = tierRow ? await ctx.db.get(tierRow.tierId) : null;
				return { customer: c, tier: tier ? { name: tier.name, level: tier.level } : null };
			})
		);

		const filtered = args.tierFilter ? withTier.filter((row) => row.tier?.name === args.tierFilter) : withTier;
		const totalCount = filtered.length;
		const pageNum = Math.max(1, args.page ?? 1);
		const pageSlice = filtered.slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE);

		const customersView = await Promise.all(
			pageSlice.map(async ({ customer, tier }) => {
				const isMember = await isActiveMember(ctx, customer._id);
				const ledger = await ctx.db
					.query("pointLedger")
					.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
					.collect();
				const points = ledger.reduce((sum, row) => sum + row.amount, 0);
				const lastActivity = ledger.reduce(
					(latest, row) => Math.max(latest, row._creationTime),
					customer._creationTime
				);
				return {
					id: customer._id,
					name: customer.name ?? customer.externalId,
					externalId: customer.externalId,
					shopName: shopNameById.get(customer.shopId) ?? "—",
					tier,
					points,
					isMember,
					lastActivity
				};
			})
		);

		return {
			customers: customersView,
			shops: shops.map((s) => ({ id: s._id, name: s.name })),
			tiers: tiers.map((t) => ({ id: t._id, name: t.name })),
			page: pageNum,
			pageSize: PAGE_SIZE,
			totalCount
		};
	}
});

const MONTHS = 6;

/** Full read side for the customer detail page — one combined query. */
export const getDetail = orgStaffQuery("customers:read")({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer || customer.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
		}
		const shop = await ctx.db.get(customer.shopId);
		const inScope = (shopId: typeof customer.shopId | undefined) => shopId == null || shopId === customer.shopId;

		const currentTierRow = await ctx.db
			.query("customerTier")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.order("desc")
			.first();
		const currentTier = currentTierRow ? await ctx.db.get(currentTierRow.tierId) : null;

		const membershipRow = await ctx.db
			.query("customerMemberships")
			.withIndex("by_customer_and_status", (q) => q.eq("customerId", customer._id).eq("status", "ACTIVE"))
			.order("desc")
			.first();
		const membershipActive = membershipRow && membershipRow.expiryDate > Date.now() ? membershipRow : null;
		const membershipPlan = membershipActive ? await ctx.db.get(membershipActive.planId) : null;

		const ledgerRows = await ctx.db
			.query("pointLedger")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.collect();
		const pointBalance = ledgerRows.reduce((sum, r) => sum + r.amount, 0);

		const now = new Date();
		const months = Array.from({ length: MONTHS }, (_, i) => {
			const d = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1);
			return { year: d.getFullYear(), month: d.getMonth(), total: 0 };
		});
		for (const row of ledgerRows) {
			const d = new Date(row._creationTime);
			const bucket = months.find((m) => m.year === d.getFullYear() && m.month === d.getMonth());
			if (bucket) bucket.total += row.amount;
		}
		const maxMonthTotal = Math.max(1, ...months.map((m) => m.total));

		const orgTiers = await ctx.db
			.query("tiers")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const scopedTiers = orgTiers.filter((t) => inScope(t.shopId)).sort((a, b) => a.level - b.level);
		const nextTier = scopedTiers.find((t) => t.level > (currentTier?.level ?? 0)) ?? null;

		let progress: { nextTierName: string; remaining: number; target: number; actual: number } | null = null;
		if (nextTier) {
			const conditions = await ctx.db
				.query("eligibilityConditions")
				.withIndex("by_target", (q) => q.eq("targetType", "TIER").eq("targetId", nextTier._id))
				.collect();
			const condition = conditions.find((c) => c.operator === "GTE" && (c.metric === "SPEND" || c.metric === "VISITS"));
			if (condition) {
				const actual = condition.metric === "SPEND" ? customer.totalSpend : customer.visitCount;
				progress = { nextTierName: nextTier.name, remaining: Math.max(condition.value - actual, 0), target: condition.value, actual };
			}
		}

		const rewardGrants = await ctx.db
			.query("customerRewards")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.collect();
		const grantedRewardIds = new Set(rewardGrants.map((r) => r.rewardId));
		const rewards = await Promise.all(
			rewardGrants.map(async (r) => {
				const def = await ctx.db.get(r.rewardId);
				return { name: def?.name ?? "", grantedAt: r._creationTime };
			})
		);

		const couponGrants = await ctx.db
			.query("couponInstances")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.collect();
		const coupons = await Promise.all(
			couponGrants.map(async (c) => {
				const def = await ctx.db.get(c.couponDefinitionId);
				return {
					name: def?.name ?? "",
					code: c.code,
					status: c.status,
					expiresAt: c.expiresAt,
					value: def ? (def.discountType === "PERCENTAGE" ? `${def.discountValue}%` : `₹${def.discountValue}`) : ""
				};
			})
		);

		const allRewards = (
			await ctx.db
				.query("rewardDefinitions")
				.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
				.collect()
		).filter((r) => inScope(r.shopId));

		const allCouponDefs = (
			await ctx.db
				.query("couponDefinitions")
				.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
				.collect()
		).filter((c) => inScope(c.shopId));

		const activeMemberships = await ctx.db
			.query("customerMemberships")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.collect();
		const activePlanIds = new Set(
			activeMemberships.filter((m) => m.status === "ACTIVE" && m.expiryDate > Date.now()).map((m) => m.planId)
		);

		const allPlans = (
			await ctx.db
				.query("membershipPlans")
				.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
				.collect()
		).filter((p) => inScope(p.shopId));

		return {
			customer: {
				id: customer._id,
				name: customer.name ?? customer.externalId,
				externalId: customer.externalId,
				phone: customer.phone,
				shopName: shop?.name ?? "—",
				totalSpend: customer.totalSpend,
				visitCount: customer.visitCount
			},
			currentTier: currentTier ? { id: currentTier._id, name: currentTier.name, level: currentTier.level, pointMultiplier: currentTier.pointMultiplier } : null,
			membershipPlan: membershipPlan ? { name: membershipPlan.name } : null,
			membershipExpiry: membershipActive?.expiryDate ?? null,
			pointBalance,
			months: months.map((m) => ({
				label: new Date(m.year, m.month, 1).toLocaleDateString(undefined, { month: "short" }),
				total: m.total,
				pct: Math.round((m.total / maxMonthTotal) * 100)
			})),
			progress,
			rewards,
			coupons,
			tiers: scopedTiers.map((t) => ({ id: t._id, name: t.name, level: t.level })),
			availableRewards: allRewards.filter((r) => !grantedRewardIds.has(r._id)).map((r) => ({ id: r._id, name: r.name })),
			availableCoupons: allCouponDefs.map((c) => ({ id: c._id, name: c.name, validityDays: c.validityDays })),
			availablePlans: allPlans
				.filter((p) => !activePlanIds.has(p._id))
				.map((p) => ({ id: p._id, name: p.name, price: p.price }))
		};
	}
});
