import { v } from "convex/values";
import { internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendEmail } from "./lib/email";
import { renderBlocksToHtml, type EmailBlock, type ResolvedReward, type ResolvedCoupon } from "./lib/emailBlocks";

/**
 * Automatic, event-triggered customer emails — a tier upgrade, a newly
 * granted reward or coupon, a new membership enrollment. Distinct from
 * convex/newsletter.ts's campaigns: those are staff-authored and either
 * scheduled or one-off; these fire on their own, the moment the loyalty
 * engine (convex/lib/loyaltyEngine.ts) actually changes something for one
 * customer. Fixed system templates for now (built from the same block
 * renderer campaigns use) — no staff-facing customization yet, same
 * "basic for now" scoping the newsletter itself started with.
 *
 * Hooked in via `scheduleGrantEmail`/`scheduleMembershipEmail` (see
 * convex/engine.ts and convex/customerGrants.ts), called right alongside
 * the existing `schedulePassUpdate` at every place the loyalty engine
 * grants something or enrolls a membership — both the public /v1 API path
 * and the staff-dashboard manual-grant path.
 */

export const getCustomerForEmail = internalQuery({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer?.email) return null;
		return { email: customer.email, name: customer.name ?? null, organizationId: customer.organizationId };
	}
});

export const getCouponInstancesByCode = internalQuery({
	args: { codes: v.array(v.string()) },
	handler: async (ctx, args) => {
		const results: Record<string, ResolvedCoupon & { couponDefinitionId: string }> = {};
		for (const code of args.codes) {
			const instance = await ctx.db
				.query("couponInstances")
				.withIndex("by_code", (q) => q.eq("code", code))
				.unique();
			if (!instance) continue;
			const def = await ctx.db.get(instance.couponDefinitionId);
			if (!def) continue;
			results[code] = {
				couponDefinitionId: instance.couponDefinitionId,
				code: instance.code,
				discountValue: def.discountValue,
				discountType: def.discountType,
				expiresAt: instance.expiresAt
			};
		}
		return results;
	}
});

/**
 * Composes and sends one email covering everything newly granted in a
 * single evaluateAndGrant/enrollMembership call — a tier-up that also
 * unlocks a reward and a coupon is one email, not three.
 */
export const sendGrantEmail = internalAction({
	args: {
		customerId: v.id("customers"),
		tiers: v.array(v.object({ id: v.id("tiers"), name: v.string() })),
		rewardIds: v.array(v.id("rewardDefinitions")),
		couponCodes: v.array(v.string())
	},
	handler: async (ctx, args) => {
		if (args.tiers.length === 0 && args.rewardIds.length === 0 && args.couponCodes.length === 0) return;

		const customer = await ctx.runQuery(internal.transactional.getCustomerForEmail, { customerId: args.customerId });
		if (!customer) return;

		const rewardEntries =
			args.rewardIds.length > 0
				? await ctx.runQuery(internal.newsletter.getRewardsByIds, { rewardIds: args.rewardIds })
				: [];
		const rewards: Record<string, ResolvedReward> = Object.fromEntries(rewardEntries);

		const couponsByCode =
			args.couponCodes.length > 0
				? await ctx.runQuery(internal.transactional.getCouponInstancesByCode, { codes: args.couponCodes })
				: {};
		const coupons: Record<string, ResolvedCoupon> = {};
		for (const entry of Object.values(couponsByCode)) {
			coupons[entry.couponDefinitionId] = entry;
		}

		const blocks: EmailBlock[] = [{ type: "heading", text: "You've got new perks" }];
		for (const tier of args.tiers) {
			blocks.push({ type: "paragraph", text: `You've been upgraded to ${tier.name}.` });
		}
		for (const [rewardId] of rewardEntries) {
			blocks.push({ type: "reward", rewardId });
		}
		for (const entry of Object.values(couponsByCode)) {
			blocks.push({ type: "coupon", couponDefinitionId: entry.couponDefinitionId });
		}

		const html = renderBlocksToHtml(blocks, { rewards, coupons });
		const subject =
			args.tiers.length > 0
				? `You've been upgraded to ${args.tiers[0].name}`
				: rewardEntries.length > 0
					? `You've unlocked ${rewardEntries[0][1].name}`
					: "You've got a new coupon";

		try {
			await sendEmail({ to: customer.email, subject, html });
		} catch (err) {
			console.error("Failed to send grant notification email", err);
		}
	}
});

export const sendMembershipEmail = internalAction({
	args: { customerId: v.id("customers"), planId: v.id("membershipPlans") },
	handler: async (ctx, args) => {
		const customer = await ctx.runQuery(internal.transactional.getCustomerForEmail, { customerId: args.customerId });
		if (!customer) return;

		const plan = await ctx.runQuery(internal.membershipPlans.internalGet, {
			organizationId: customer.organizationId,
			planId: args.planId
		});
		if (!plan) return;

		const blocks: EmailBlock[] = [
			{ type: "heading", text: `Welcome to ${plan.name}` },
			{ type: "paragraph", text: `You're now enrolled in ${plan.name}. Your membership benefits are active on your next visit.` }
		];
		const html = renderBlocksToHtml(blocks);

		try {
			await sendEmail({ to: customer.email, subject: `Welcome to ${plan.name}`, html });
		} catch (err) {
			console.error("Failed to send membership welcome email", err);
		}
	}
});
