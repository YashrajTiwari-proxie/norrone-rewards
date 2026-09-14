import { v } from "convex/values";
import { orgStaffQuery } from "./lib/authz";

const WEEKS = 12;

/**
 * Port of src/routes/orgs/[orgId]/+page.server.ts's overview aggregation.
 * Convex has no SQL-side count()/group-by, so this pulls the relevant
 * rows and aggregates in JS — fine at this data scale (per-org, not
 * platform-wide).
 *
 * SECURITY: this was a plain `query` gated only by `requireAuthUserId`
 * (any signed-in user) until an audit caught it — any authenticated user
 * could pass an arbitrary organizationId and read that org's full
 * customer/points/coupon analytics. Fixed by switching to orgStaffQuery,
 * matching every other org-scoped query in this codebase.
 */
export const getOverview = orgStaffQuery("customers:read")({
	args: { shopId: v.optional(v.id("shops")) },
	handler: async (ctx, args) => {
		const organizationId = ctx.organizationId;

		const allCustomers = await ctx.db
			.query("customers")
			.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
			.collect();
		const customers = args.shopId ? allCustomers.filter((c) => c.shopId === args.shopId) : allCustomers;
		const customerIds = new Set(customers.map((c) => c._id));

		let activeMemberCount = 0;
		const now = Date.now();
		const twelveWeeksAgo = now - WEEKS * 7 * 24 * 60 * 60 * 1000;

		const weekBuckets = Array.from({ length: WEEKS }, (_, i) => ({
			start: now - (WEEKS - i) * 7 * 24 * 60 * 60 * 1000,
			total: 0
		}));
		let pointsIssuedTotal = 0;

		const latestTierByCustomer = new Map<string, string>();
		const couponStatusCounts: Record<string, number> = { ISSUED: 0, REDEEMED: 0, EXPIRED: 0, CANCELLED: 0 };
		const recentCoupons: Array<{
			code: string;
			expiresAt: number;
			_creationTime: number;
			couponDefinition: { name: string; discountValue: number; discountType: "PERCENTAGE" | "FIXED" } | null;
		}> = [];

		for (const customer of customers) {
			const memberships = await ctx.db
				.query("customerMemberships")
				.withIndex("by_customer_and_status", (q) => q.eq("customerId", customer._id).eq("status", "ACTIVE"))
				.collect();
			if (memberships.some((m) => m.expiryDate > now)) activeMemberCount++;

			const ledgerRows = await ctx.db
				.query("pointLedger")
				.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
				.collect();
			for (const row of ledgerRows) {
				if (row._creationTime < twelveWeeksAgo) continue;
				pointsIssuedTotal += Math.max(0, row.amount);
				for (let i = weekBuckets.length - 1; i >= 0; i--) {
					if (row._creationTime >= weekBuckets[i].start) {
						weekBuckets[i].total += row.amount;
						break;
					}
				}
			}

			const tierRow = await ctx.db
				.query("customerTier")
				.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
				.order("desc")
				.first();
			if (tierRow) {
				const tier = await ctx.db.get(tierRow.tierId);
				if (tier) latestTierByCustomer.set(customer._id, tier.name);
			}

			const couponRows = await ctx.db
				.query("couponInstances")
				.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
				.collect();
			for (const c of couponRows) {
				couponStatusCounts[c.status] = (couponStatusCounts[c.status] ?? 0) + 1;
				if (c.status === "ISSUED") {
					const def = await ctx.db.get(c.couponDefinitionId);
					recentCoupons.push({
						code: c.code,
						expiresAt: c.expiresAt,
						_creationTime: c._creationTime,
						couponDefinition: def
							? { name: def.name, discountValue: def.discountValue, discountType: def.discountType }
							: null
					});
				}
			}
		}

		const maxWeekTotal = Math.max(1, ...weekBuckets.map((w) => w.total));
		const tierCounts = new Map<string, number>();
		for (const name of latestTierByCustomer.values()) tierCounts.set(name, (tierCounts.get(name) ?? 0) + 1);
		const tierDist = Array.from(tierCounts.entries())
			.map(([name, count]) => ({
				name,
				count,
				pct: customers.length ? Math.round((count / customers.length) * 100) : 0
			}))
			.sort((a, b) => b.count - a.count);

		recentCoupons.sort((a, b) => b._creationTime - a._creationTime);

		const [tiers, pointRules, rewards, couponDefs, plans] = await Promise.all([
			ctx.db.query("tiers").withIndex("by_organization", (q) => q.eq("organizationId", organizationId)).collect(),
			ctx.db
				.query("pointRules")
				.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
				.collect(),
			ctx.db
				.query("rewardDefinitions")
				.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
				.collect(),
			ctx.db
				.query("couponDefinitions")
				.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
				.collect(),
			ctx.db
				.query("membershipPlans")
				.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
				.collect()
		]);

		return {
			stats: {
				customerCount: customers.length,
				activeMemberCount,
				pointsIssuedTotal,
				couponsRedeemed: couponStatusCounts.REDEEMED
			},
			weekBuckets: weekBuckets.map((w) => ({ total: w.total, pct: Math.round((w.total / maxWeekTotal) * 100) })),
			tierDist,
			couponStatusCounts,
			recentCoupons: recentCoupons.slice(0, 3),
			modules: [
				{ id: "membership", label: "Membership", configured: plans.length > 0 },
				{ id: "tiers", label: "Tiers", configured: tiers.length > 0 },
				{ id: "points", label: "Points", configured: pointRules.length > 0 },
				{ id: "rewards", label: "Rewards", configured: rewards.length > 0 },
				{ id: "coupons", label: "Coupons", configured: couponDefs.length > 0 }
			]
		};
	}
});
