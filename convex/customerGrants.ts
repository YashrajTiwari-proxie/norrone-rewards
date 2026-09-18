import { v, ConvexError } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAuthUserId } from "./lib/authz";
import { authz } from "./authzConfig";
import { evaluateAndGrant, applyGrantedBenefits, generateCouponCode, enrollMembership as enrollMembershipEngine } from "./lib/loyaltyEngine";

/** Fire-and-forget — a customer with no saved wallet pass on either platform is the common case, not an error. See walletNode.ts's pushWalletUpdates. */
function schedulePassUpdate(ctx: MutationCtx, customerId: Id<"customers">) {
	ctx.scheduler.runAfter(0, internal.walletNode.pushWalletUpdates, { customerId });
}

/**
 * Staff-facing manual grant actions for the customer detail page
 * (customers:grant permission — see authzConfig.ts's `manager` role).
 * Distinct from the /v1/... API's engine.ts wrappers: those are
 * API-key-authenticated and meant for POS/integration traffic; these are
 * Better-Auth-session-authenticated and meant for a staff member clicking
 * a button in the dashboard. Both ultimately call the same
 * convex/lib/loyaltyEngine.ts logic.
 */

async function assertOrgStaffCanGrant(ctx: MutationCtx, organizationId: Id<"organizations">) {
	const authUserId = await requireAuthUserId(ctx);
	const membership = await ctx.db
		.query("organizationStaff")
		.withIndex("by_organization_and_user", (q) => q.eq("organizationId", organizationId).eq("authUserId", authUserId))
		.unique();
	if (!membership || !membership.isActive) {
		throw new ConvexError({ code: "ACCOUNT_INACTIVE", message: "Not an active staff member of this organization" });
	}
	await authz
		.withTenant(organizationId)
		.require(ctx, authUserId, "customers:grant", { type: "organization", id: organizationId });
	return authUserId;
}

export const manualAdjustPoints = mutation({
	args: { customerId: v.id("customers"), amount: v.number(), note: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
		await assertOrgStaffCanGrant(ctx, customer.organizationId);

		await ctx.db.insert("pointLedger", {
			customerId: args.customerId,
			amount: args.amount,
			reason: "MANUAL",
			referenceId: args.note
		});

		// A manual adjustment can cross a POINTS-based eligibility threshold,
		// so re-run the same auto-grant check the API path triggers.
		const result = await evaluateAndGrant(ctx, args.customerId);
		schedulePassUpdate(ctx, args.customerId);
		return result;
	}
});

export const manualGrantTier = mutation({
	args: { customerId: v.id("customers"), tierId: v.id("tiers") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
		await assertOrgStaffCanGrant(ctx, customer.organizationId);

		const tier = await ctx.db.get(args.tierId);
		if (!tier || tier.organizationId !== customer.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Tier not found in this organization" });
		}

		// "Current tier" is always the most-recently-inserted row (see
		// getDetail/getPassData) — so the no-op check must compare against
		// that, not "has this tierId ever been assigned before". A customer
		// who was auto-granted Gold, then promoted to Above Gold, then
		// manually set back to Gold has a *stale* Gold row already sitting
		// in the table; checking "any row with this tierId" found that old
		// row and skipped the insert entirely, silently leaving Above Gold
		// as the current tier — this was a real bug, not just a design
		// choice, and is exactly why the dashboard action wasn't working.
		const currentTierRow = await ctx.db
			.query("customerTier")
			.withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
			.order("desc")
			.first();
		if (currentTierRow?.tierId !== args.tierId) {
			await ctx.db.insert("customerTier", { customerId: args.customerId, tierId: args.tierId, source: "MANUAL" });
			// Match what an auto-grant would do: apply the tier's own benefits too.
			await applyGrantedBenefits(ctx, args.customerId, "TIER", args.tierId);
			schedulePassUpdate(ctx, args.customerId);
		}
	}
});

export const manualGrantReward = mutation({
	args: { customerId: v.id("customers"), rewardId: v.id("rewardDefinitions") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
		await assertOrgStaffCanGrant(ctx, customer.organizationId);

		const reward = await ctx.db.get(args.rewardId);
		if (!reward || reward.organizationId !== customer.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Reward not found in this organization" });
		}

		const existing = await ctx.db
			.query("customerRewards")
			.withIndex("by_customer_and_reward", (q) => q.eq("customerId", args.customerId).eq("rewardId", args.rewardId))
			.first();
		if (!existing) {
			await ctx.db.insert("customerRewards", { customerId: args.customerId, rewardId: args.rewardId });
		}
	}
});

export const manualGrantCoupon = mutation({
	args: { customerId: v.id("customers"), couponDefinitionId: v.id("couponDefinitions") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
		await assertOrgStaffCanGrant(ctx, customer.organizationId);

		const couponDef = await ctx.db.get(args.couponDefinitionId);
		if (!couponDef || couponDef.organizationId !== customer.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Coupon definition not found in this organization" });
		}

		const code = await generateCouponCode(ctx);

		await ctx.db.insert("couponInstances", {
			customerId: args.customerId,
			couponDefinitionId: args.couponDefinitionId,
			code,
			status: "ISSUED",
			expiresAt: Date.now() + couponDef.validityDays * 24 * 60 * 60 * 1000
		});

		// The code was previously discarded here — the customer detail
		// page's "Coupons" list further down the same page does show it,
		// but with no feedback at the moment of issuing, staff had no way
		// to know which of possibly several coupons was the one they just
		// created, or had to scroll to find it at all. Returning it lets
		// the drawer show it immediately.
		return { code };
	}
});

export const enrollMembership = mutation({
	args: { customerId: v.id("customers"), planId: v.id("membershipPlans") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
		await assertOrgStaffCanGrant(ctx, customer.organizationId);

		const plan = await ctx.db.get(args.planId);
		if (!plan || plan.organizationId !== customer.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Membership plan not found in this organization" });
		}

		const result = await enrollMembershipEngine(ctx, { customerId: args.customerId, planId: args.planId });
		schedulePassUpdate(ctx, args.customerId);
		return result;
	}
});

/** Re-run auto-grant eligibility now, e.g. after a manual points adjustment. */
export const reevaluateGrants = mutation({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });
		await assertOrgStaffCanGrant(ctx, customer.organizationId);
		const result = await evaluateAndGrant(ctx, args.customerId);
		schedulePassUpdate(ctx, args.customerId);
		return result;
	}
});
