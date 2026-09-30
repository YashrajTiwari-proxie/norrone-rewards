import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
	evaluateAndGrant,
	updateCustomerStats,
	enrollMembership,
	redeemCoupon,
	type EvaluateAndGrantResult
} from "./lib/loyaltyEngine";

/** See customerGrants.ts's identical helper — this is the public-API-triggered path (real POS activity), the most important one for auto-updating passes. */
function schedulePassUpdate(ctx: MutationCtx, customerId: Id<"customers">) {
	ctx.scheduler.runAfter(0, internal.walletNode.pushWalletUpdates, { customerId });
}

/** See customerGrants.ts's identical helper — fires the one automatic email covering everything newly granted in this call, if anything was. */
function scheduleGrantEmail(ctx: MutationCtx, customerId: Id<"customers">, result: EvaluateAndGrantResult) {
	if (result.tiers.length === 0 && result.rewards.length === 0 && result.coupons.length === 0) return;
	ctx.scheduler.runAfter(0, internal.transactional.sendGrantEmail, {
		customerId,
		tiers: result.tiers,
		rewardIds: result.rewards.map((r) => r.id),
		couponCodes: result.coupons.map((c) => c.code)
	});
}

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
	handler: async (ctx, args) => {
		const result = await evaluateAndGrant(ctx, args.customerId);
		schedulePassUpdate(ctx, args.customerId);
		scheduleGrantEmail(ctx, args.customerId, result);
		return result;
	}
});

export const updateCustomerStatsAction = internalMutation({
	args: {
		customerId: v.id("customers"),
		deltaSpend: v.optional(v.number()),
		deltaVisits: v.optional(v.number()),
		action: v.optional(v.string()),
		idempotencyKey: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const result = await updateCustomerStats(ctx, args);
		schedulePassUpdate(ctx, args.customerId);
		if (!("idempotent" in result)) {
			scheduleGrantEmail(ctx, args.customerId, result.newlyGranted);
		}
		return result;
	}
});

export const enrollMembershipAction = internalMutation({
	args: {
		customerId: v.id("customers"),
		planId: v.id("membershipPlans"),
		idempotencyKey: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const result = await enrollMembership(ctx, args);
		schedulePassUpdate(ctx, args.customerId);
		if (!("idempotent" in result)) {
			ctx.scheduler.runAfter(0, internal.transactional.sendMembershipEmail, {
				customerId: args.customerId,
				planId: args.planId
			});
			scheduleGrantEmail(ctx, args.customerId, result.newlyGranted);
		}
		return result;
	}
});

export const redeemCouponAction = internalMutation({
	args: {
		code: v.string(),
		organizationId: v.id("organizations")
	},
	handler: async (ctx, args) => redeemCoupon(ctx, args)
});
