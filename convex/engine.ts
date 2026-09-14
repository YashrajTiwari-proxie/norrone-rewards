import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
	evaluateAndGrant,
	updateCustomerStats,
	enrollMembership,
	redeemCoupon
} from "./lib/loyaltyEngine";

/**
 * internalMutation wrappers around convex/lib/loyaltyEngine.ts — the port
 * of supabase's evaluate_and_grant/update_customer_stats/
 * enroll_membership/redeem_coupon plpgsql functions. Internal (not
 * `mutation`) because, like their Postgres `security definer` originals,
 * these are only ever meant to be called by a trusted layer that has
 * already authenticated the caller — the future public /v1/... HTTP
 * Actions (API-key authenticated, see schema.ts's apiKeys table) — never
 * directly by a client argument. A staff-facing manual-grant action
 * (customers.ts, not yet ported) will call `evaluateAndGrantAction`
 * itself via ctx.runMutation(internal.engine...) after checking
 * shopStaffMutation/orgStaffMutation permissions, exactly the same way
 * these are not directly reachable from the client.
 */

export const evaluateAndGrantAction = internalMutation({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => evaluateAndGrant(ctx, args.customerId)
});

export const updateCustomerStatsAction = internalMutation({
	args: {
		customerId: v.id("customers"),
		deltaSpend: v.optional(v.number()),
		deltaVisits: v.optional(v.number()),
		action: v.optional(v.string()),
		idempotencyKey: v.optional(v.string())
	},
	handler: async (ctx, args) => updateCustomerStats(ctx, args)
});

export const enrollMembershipAction = internalMutation({
	args: {
		customerId: v.id("customers"),
		planId: v.id("membershipPlans"),
		idempotencyKey: v.optional(v.string())
	},
	handler: async (ctx, args) => enrollMembership(ctx, args)
});

export const redeemCouponAction = internalMutation({
	args: {
		code: v.string(),
		organizationId: v.id("organizations")
	},
	handler: async (ctx, args) => redeemCoupon(ctx, args)
});
