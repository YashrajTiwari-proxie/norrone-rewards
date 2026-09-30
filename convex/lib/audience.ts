import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { latestCustomerTier } from "./loyaltyEngine";

type ReadCtx = QueryCtx | MutationCtx;

export type AudienceFilter = {
	tierIds?: Id<"tiers">[];
	membershipPlanIds?: Id<"membershipPlans">[];
	pointsMin?: number;
	pointsMax?: number;
	customerIds?: Id<"customers">[];
};

function normalizedEmail(customer: Doc<"customers">): string | null {
	const email = customer.email?.trim().toLowerCase();
	return email ? email : null;
}

async function pointsBalance(ctx: ReadCtx, customerId: Id<"customers">): Promise<number> {
	const ledger = await ctx.db
		.query("pointLedger")
		.withIndex("by_customer", (q) => q.eq("customerId", customerId))
		.collect();
	return ledger.reduce((sum, row) => sum + row.amount, 0);
}

async function hasActiveMembershipInAny(
	ctx: ReadCtx,
	customerId: Id<"customers">,
	planIds: Id<"membershipPlans">[]
): Promise<boolean> {
	const planIdSet = new Set(planIds);
	const memberships = await ctx.db
		.query("customerMemberships")
		.withIndex("by_customer_and_status", (q) => q.eq("customerId", customerId).eq("status", "ACTIVE"))
		.collect();
	const now = Date.now();
	return memberships.some((m) => m.expiryDate > now && planIdSet.has(m.planId));
}

/**
 * Resolves a campaign's target audience to a deduped list of
 * {customerId, email}. `filter.customerIds`, when non-empty, is an
 * explicit hand-picked list and short-circuits every other field —
 * that's how a single-recipient or a specific-multi-recipient send is
 * expressed. Otherwise every set field is AND'd together (tierIds and
 * membershipPlanIds are each OR'd internally — "any matching tier/plan").
 * An entirely empty filter (or none at all) means "every customer with an
 * email on file", same as before targeting existed.
 */
export async function computeOrgAudience(
	ctx: ReadCtx,
	organizationId: Id<"organizations">,
	filter: AudienceFilter | undefined
): Promise<Array<{ customerId: Id<"customers">; email: string }>> {
	if (filter?.customerIds && filter.customerIds.length > 0) {
		const seen = new Set<string>();
		const result: Array<{ customerId: Id<"customers">; email: string }> = [];
		for (const customerId of filter.customerIds) {
			const customer = await ctx.db.get(customerId);
			if (!customer || customer.organizationId !== organizationId) continue;
			const email = normalizedEmail(customer);
			if (!email || seen.has(email)) continue;
			seen.add(email);
			result.push({ customerId, email });
		}
		return result;
	}

	const customers = await ctx.db
		.query("customers")
		.withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
		.collect();

	const seen = new Set<string>();
	const result: Array<{ customerId: Id<"customers">; email: string }> = [];
	for (const customer of customers) {
		const email = normalizedEmail(customer);
		if (!email || seen.has(email)) continue;

		if (filter?.tierIds && filter.tierIds.length > 0) {
			const tierRow = await latestCustomerTier(ctx, customer._id);
			if (!tierRow || !filter.tierIds.includes(tierRow.tierId)) continue;
		}
		if (filter?.membershipPlanIds && filter.membershipPlanIds.length > 0) {
			if (!(await hasActiveMembershipInAny(ctx, customer._id, filter.membershipPlanIds))) continue;
		}
		if (filter?.pointsMin !== undefined || filter?.pointsMax !== undefined) {
			const balance = await pointsBalance(ctx, customer._id);
			if (filter.pointsMin !== undefined && balance < filter.pointsMin) continue;
			if (filter.pointsMax !== undefined && balance > filter.pointsMax) continue;
		}

		seen.add(email);
		result.push({ customerId: customer._id, email });
	}
	return result;
}
