import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

type ReadCtx = QueryCtx | MutationCtx;

/**
 * Port of supabase/migrations 00000000000004 through 00000000000013's
 * plpgsql functions (applicable_multiplier, is_active_member,
 * eval_condition, evaluate_and_grant, apply_granted_benefits,
 * update_customer_stats, enroll_membership, redeem_coupon,
 * generate_coupon_code) onto Convex documents. Convex mutations are
 * already transactional (optimistic concurrency control across every
 * document a mutation reads or writes), so none of the `for update`
 * row-locking or `security definer` machinery from the originals has an
 * equivalent here — the guarantees just come for free from being inside
 * a mutation.
 *
 * These are plain functions, not Convex functions themselves — see
 * convex/engine.ts for the internalMutation wrappers the future public
 * API (and staff-triggered actions) actually call.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function randomCouponCode(): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let code = "";
	for (let i = 0; i < 10; i++) {
		code += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return code;
}

/**
 * Postgres enforced `code text unique` at the schema level; Convex has no
 * equivalent, and couponInstances.code is looked up with `.unique()`
 * everywhere (redeemCoupon, the /v1 API) — a collision there is a hard
 * crash, not a soft conflict, so code generation itself has to be the
 * thing that guarantees uniqueness. Retries are effectively never taken
 * (36^10 codes), but this is genuinely reachable, unlike a
 * check-then-insert race: the same mutation transaction sees the row it
 * just inserted, so this loop can't itself introduce a race.
 */
export async function generateCouponCode(ctx: ReadCtx): Promise<string> {
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = randomCouponCode();
		const existing = await ctx.db
			.query("couponInstances")
			.withIndex("by_code", (q) => q.eq("code", code))
			.first();
		if (!existing) return code;
	}
	throw new Error("Failed to generate a unique coupon code after 5 attempts");
}

async function latestCustomerTier(ctx: ReadCtx, customerId: Id<"customers">) {
	return await ctx.db
		.query("customerTier")
		.withIndex("by_customer", (q) => q.eq("customerId", customerId))
		.order("desc")
		.first();
}

async function latestActiveMembership(ctx: ReadCtx, customerId: Id<"customers">) {
	return await ctx.db
		.query("customerMemberships")
		.withIndex("by_customer_and_status", (q) => q.eq("customerId", customerId).eq("status", "ACTIVE"))
		.order("desc")
		.first();
}

/**
 * True membership-active check, used by eval_condition's
 * MEMBERSHIP_ACTIVE metric and member_only gating — requires status
 * ACTIVE AND an unexpired expiryDate.
 */
export async function isActiveMember(ctx: ReadCtx, customerId: Id<"customers">): Promise<boolean> {
	const membership = await latestActiveMembership(ctx, customerId);
	return membership != null && membership.expiryDate > Date.now();
}

/**
 * §4: never stack multipliers — take the highest applicable one.
 * Deliberately mirrors the original's asymmetry: the membership leg here
 * only checks `status === "ACTIVE"`, not expiry (unlike isActiveMember
 * above) — that's exactly what
 * supabase/migrations/00000000000006_membership.sql's applicable_multiplier
 * did, carried over as-is rather than silently fixed during the port.
 */
export async function applicableMultiplier(ctx: ReadCtx, customerId: Id<"customers">): Promise<number> {
	const tierRow = await latestCustomerTier(ctx, customerId);
	const tierMultiplier = tierRow ? ((await ctx.db.get(tierRow.tierId))?.pointMultiplier ?? 1.0) : 1.0;

	const membershipRow = await latestActiveMembership(ctx, customerId);
	const planMultiplier = membershipRow
		? ((await ctx.db.get(membershipRow.planId))?.pointMultiplier ?? 1.0)
		: 1.0;

	return Math.max(tierMultiplier, planMultiplier, 1.0);
}

/**
 * period support: LIFETIME uses the customer's running totals.
 * MONTHLY/YEARLY windowing needs per-period aggregates there's no source
 * for yet (no timestamped spend/visit events, only running counters) —
 * treated as LIFETIME for now, exactly like the original.
 */
export async function evalCondition(
	ctx: ReadCtx,
	customerId: Id<"customers">,
	condition: Doc<"eligibilityConditions">
): Promise<boolean> {
	let actual: number;
	switch (condition.metric) {
		case "SPEND": {
			const customer = await ctx.db.get(customerId);
			actual = customer?.totalSpend ?? 0;
			break;
		}
		case "VISITS": {
			const customer = await ctx.db.get(customerId);
			actual = customer?.visitCount ?? 0;
			break;
		}
		case "POINTS": {
			const ledger = await ctx.db
				.query("pointLedger")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect();
			actual = ledger.reduce((sum, row) => sum + row.amount, 0);
			break;
		}
		case "TIER_LEVEL": {
			const tierRow = await latestCustomerTier(ctx, customerId);
			const tier = tierRow ? await ctx.db.get(tierRow.tierId) : null;
			actual = tier?.level ?? 0;
			break;
		}
		case "MEMBERSHIP_ACTIVE": {
			actual = (await isActiveMember(ctx, customerId)) ? 1 : 0;
			break;
		}
		default:
			return false;
	}

	switch (condition.operator) {
		case "GTE":
			return actual >= condition.value;
		case "LTE":
			return actual <= condition.value;
		case "EQ":
			return actual === condition.value;
		default:
			return false;
	}
}

async function conditionsFor(
	ctx: ReadCtx,
	targetType: "TIER" | "REWARD" | "COUPON",
	targetId: Id<"tiers"> | Id<"rewardDefinitions"> | Id<"couponDefinitions">
) {
	return await ctx.db
		.query("eligibilityConditions")
		.withIndex("by_target", (q) => q.eq("targetType", targetType).eq("targetId", targetId))
		.collect();
}

async function passesAllConditions(
	ctx: ReadCtx,
	customerId: Id<"customers">,
	conditions: Doc<"eligibilityConditions">[]
): Promise<boolean> {
	for (const condition of conditions) {
		if (!(await evalCondition(ctx, customerId, condition))) {
			return false;
		}
	}
	return true;
}

export type GrantedBenefitsResult = {
	rewards: Array<{ id: Id<"rewardDefinitions"> }>;
	coupons: Array<{ code: string; status: "ISSUED" }>;
};

/** Applies every granted_benefits row for one (sourceType, sourceId), e.g. a TIER's or MEMBERSHIP_PLAN's benefits. */
export async function applyGrantedBenefits(
	ctx: MutationCtx,
	customerId: Id<"customers">,
	sourceType: "MEMBERSHIP_PLAN" | "TIER",
	sourceId: Id<"membershipPlans"> | Id<"tiers">
): Promise<GrantedBenefitsResult> {
	const benefits = await ctx.db
		.query("grantedBenefits")
		.withIndex("by_source", (q) => q.eq("sourceType", sourceType).eq("sourceId", sourceId))
		.collect();

	const rewards: GrantedBenefitsResult["rewards"] = [];
	const coupons: GrantedBenefitsResult["coupons"] = [];

	for (const benefit of benefits) {
		switch (benefit.benefitType) {
			case "POINTS": {
				await ctx.db.insert("pointLedger", {
					customerId,
					amount: benefit.pointsAmount ?? 0,
					reason: "MANUAL",
					referenceId: `${sourceType}:${sourceId}`
				});
				break;
			}
			case "TIER": {
				const tierId = benefit.benefitId as Id<"tiers">;
				const existing = await ctx.db
					.query("customerTier")
					.withIndex("by_customer", (q) => q.eq("customerId", customerId))
					.filter((q) => q.eq(q.field("tierId"), tierId))
					.first();
				if (!existing) {
					await ctx.db.insert("customerTier", { customerId, tierId, source: "AUTO" });
				}
				break;
			}
			case "REWARD": {
				const rewardId = benefit.benefitId as Id<"rewardDefinitions">;
				const existing = await ctx.db
					.query("customerRewards")
					.withIndex("by_customer_and_reward", (q) => q.eq("customerId", customerId).eq("rewardId", rewardId))
					.first();
				if (!existing) {
					await ctx.db.insert("customerRewards", { customerId, rewardId });
					rewards.push({ id: rewardId });
				}
				break;
			}
			case "COUPON": {
				const couponDefinitionId = benefit.benefitId as Id<"couponDefinitions">;
				const couponDef = await ctx.db.get(couponDefinitionId);
				if (!couponDef) break;
				const code = await generateCouponCode(ctx);
				await ctx.db.insert("couponInstances", {
					customerId,
					couponDefinitionId,
					code,
					status: "ISSUED",
					expiresAt: Date.now() + couponDef.validityDays * DAY_MS
				});
				coupons.push({ code, status: "ISSUED" });
				break;
			}
		}
	}

	return { rewards, coupons };
}

export type EvaluateAndGrantResult = {
	tiers: Array<{ id: Id<"tiers">; name: string }>;
	rewards: Array<{ id: Id<"rewardDefinitions">; name?: string }>;
	coupons: Array<{ code: string; status: "ISSUED" }>;
};

/**
 * §5.1: tiers, then rewards, then coupons. Each grant applies its own
 * granted_benefits once — no recursion. A definition with zero
 * eligibility conditions is never auto-granted (an empty AND is
 * vacuously true otherwise — the exact bug
 * supabase/migrations/00000000000013 fixed; ported here with the fix
 * already in place).
 */
export async function evaluateAndGrant(ctx: MutationCtx, customerId: Id<"customers">): Promise<EvaluateAndGrantResult> {
	const customer = await ctx.db.get(customerId);
	if (!customer) {
		return { tiers: [], rewards: [], coupons: [] };
	}
	const isMember = await isActiveMember(ctx, customerId);

	const grantedTiers: EvaluateAndGrantResult["tiers"] = [];
	const grantedRewards: EvaluateAndGrantResult["rewards"] = [];
	const grantedCoupons: EvaluateAndGrantResult["coupons"] = [];

	const heldTierIds = new Set(
		(
			await ctx.db
				.query("customerTier")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		).map((row) => row.tierId)
	);

	// TIER --------------------------------------------------------------
	const tiers = await ctx.db
		.query("tiers")
		.withIndex("by_organization", (q) => q.eq("organizationId", customer.organizationId))
		.collect();
	for (const tier of tiers) {
		if (tier.shopId != null && tier.shopId !== customer.shopId) continue;
		if (heldTierIds.has(tier._id)) continue;
		const conditions = await conditionsFor(ctx, "TIER", tier._id);
		if (conditions.length === 0) continue;
		if (!(await passesAllConditions(ctx, customerId, conditions))) continue;

		await ctx.db.insert("customerTier", { customerId, tierId: tier._id, source: "AUTO" });
		grantedTiers.push({ id: tier._id, name: tier.name });
		const benefitResult = await applyGrantedBenefits(ctx, customerId, "TIER", tier._id);
		grantedRewards.push(...benefitResult.rewards);
		grantedCoupons.push(...benefitResult.coupons);
	}

	// REWARD --------------------------------------------------------------
	const heldRewardIds = new Set(
		(
			await ctx.db
				.query("customerRewards")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		).map((row) => row.rewardId)
	);
	const rewardDefs = await ctx.db
		.query("rewardDefinitions")
		.withIndex("by_organization", (q) => q.eq("organizationId", customer.organizationId))
		.collect();
	for (const reward of rewardDefs) {
		if (reward.shopId != null && reward.shopId !== customer.shopId) continue;
		if (reward.memberOnly && !isMember) continue;
		if (heldRewardIds.has(reward._id)) continue;
		const conditions = await conditionsFor(ctx, "REWARD", reward._id);
		if (conditions.length === 0) continue;
		if (!(await passesAllConditions(ctx, customerId, conditions))) continue;

		await ctx.db.insert("customerRewards", { customerId, rewardId: reward._id });
		grantedRewards.push({ id: reward._id, name: reward.name });
	}

	// COUPON --------------------------------------------------------------
	const heldCouponDefIds = new Set(
		(
			await ctx.db
				.query("couponInstances")
				.withIndex("by_customer", (q) => q.eq("customerId", customerId))
				.collect()
		).map((row) => row.couponDefinitionId)
	);
	const couponDefs = await ctx.db
		.query("couponDefinitions")
		.withIndex("by_organization", (q) => q.eq("organizationId", customer.organizationId))
		.collect();
	for (const couponDef of couponDefs) {
		if (couponDef.shopId != null && couponDef.shopId !== customer.shopId) continue;
		if (couponDef.memberOnly && !isMember) continue;
		if (heldCouponDefIds.has(couponDef._id)) continue;
		const conditions = await conditionsFor(ctx, "COUPON", couponDef._id);
		if (conditions.length === 0) continue;
		if (!(await passesAllConditions(ctx, customerId, conditions))) continue;

		const code = await generateCouponCode(ctx);
		await ctx.db.insert("couponInstances", {
			customerId,
			couponDefinitionId: couponDef._id,
			code,
			status: "ISSUED",
			expiresAt: Date.now() + couponDef.validityDays * DAY_MS
		});
		grantedCoupons.push({ code, status: "ISSUED" });
	}

	return { tiers: grantedTiers, rewards: grantedRewards, coupons: grantedCoupons };
}

/** Returns true (and records the key) the first time it's seen for this key; false if it's a replay. */
async function claimIdempotencyKey(
	ctx: MutationCtx,
	key: string | undefined,
	organizationId: Id<"organizations">
): Promise<boolean> {
	if (!key) return true;
	const existing = await ctx.db
		.query("idempotencyKeys")
		.withIndex("by_key", (q) => q.eq("key", key))
		.unique();
	if (existing) return false;
	await ctx.db.insert("idempotencyKeys", { key, organizationId });
	return true;
}

export type UpdateCustomerStatsResult =
	| { idempotent: true }
	| { customerId: Id<"customers">; newlyGranted: EvaluateAndGrantResult };

/**
 * §5.3: apply a spend/visit delta, award ACTION points for `action` (the
 * most shop-specific matching point_rules row wins over an org-wide
 * template), then run evaluate_and_grant.
 */
export async function updateCustomerStats(
	ctx: MutationCtx,
	args: {
		customerId: Id<"customers">;
		deltaSpend?: number;
		deltaVisits?: number;
		action?: string;
		idempotencyKey?: string;
	}
): Promise<UpdateCustomerStatsResult> {
	const customer = await ctx.db.get(args.customerId);
	if (!customer) {
		throw new Error("Customer not found");
	}

	if (!(await claimIdempotencyKey(ctx, args.idempotencyKey, customer.organizationId))) {
		return { idempotent: true };
	}

	await ctx.db.patch(args.customerId, {
		totalSpend: customer.totalSpend + (args.deltaSpend ?? 0),
		visitCount: customer.visitCount + (args.deltaVisits ?? 0)
	});

	if (args.action) {
		const isMember = await isActiveMember(ctx, args.customerId);
		const rules = await ctx.db
			.query("pointRules")
			.withIndex("by_organization", (q) => q.eq("organizationId", customer.organizationId))
			.collect();
		const candidates = rules.filter(
			(rule) =>
				(rule.shopId == null || rule.shopId === customer.shopId) &&
				rule.action === args.action &&
				(!rule.memberOnly || isMember)
		);
		// shop-specific rule wins over an org-wide (shopId == null) one —
		// mirrors `order by shop_id nulls last limit 1`.
		candidates.sort((a, b) => (a.shopId == null ? 1 : 0) - (b.shopId == null ? 1 : 0));
		const rule = candidates[0];
		if (rule) {
			const multiplier = await applicableMultiplier(ctx, args.customerId);
			await ctx.db.insert("pointLedger", {
				customerId: args.customerId,
				amount: rule.pointsPerUnit * multiplier,
				reason: "ACTION",
				referenceId: args.action
			});
		}
	}

	const newlyGranted = await evaluateAndGrant(ctx, args.customerId);
	return { customerId: args.customerId, newlyGranted };
}

export type EnrollMembershipResult =
	| { idempotent: true }
	| { customerId: Id<"customers">; newlyGranted: EvaluateAndGrantResult };

export async function enrollMembership(
	ctx: MutationCtx,
	args: { customerId: Id<"customers">; planId: Id<"membershipPlans">; idempotencyKey?: string }
): Promise<EnrollMembershipResult> {
	const customer = await ctx.db.get(args.customerId);
	if (!customer) {
		throw new Error("Customer not found");
	}
	if (!(await claimIdempotencyKey(ctx, args.idempotencyKey, customer.organizationId))) {
		return { idempotent: true };
	}

	const plan = await ctx.db.get(args.planId);
	if (!plan) {
		throw new Error("Membership plan not found");
	}

	await ctx.db.insert("customerMemberships", {
		customerId: args.customerId,
		planId: args.planId,
		status: "ACTIVE",
		startDate: Date.now(),
		expiryDate: Date.now() + plan.durationDays * DAY_MS
	});

	await applyGrantedBenefits(ctx, args.customerId, "MEMBERSHIP_PLAN", args.planId);
	const newlyGranted = await evaluateAndGrant(ctx, args.customerId);
	return { customerId: args.customerId, newlyGranted };
}

export type RedeemCouponResult =
	| { error: "NOT_FOUND" | "ALREADY_REDEEMED" | "NOT_REDEEMABLE" | "EXPIRED" }
	| { ok: true; couponInstanceId: Id<"couponInstances"> };

/**
 * No :shopId in the redeem URL, so this is the tenant check itself: the
 * coupon (via its customer) must belong to the calling API key's
 * organization. Every failure path before "ok" returns the same
 * NOT_FOUND-shaped family of errors a cross-tenant probe would see, never
 * leaking whether a code exists in a different org.
 */
export async function redeemCoupon(
	ctx: MutationCtx,
	args: { code: string; organizationId: Id<"organizations"> }
): Promise<RedeemCouponResult> {
	const coupon = await ctx.db
		.query("couponInstances")
		.withIndex("by_code", (q) => q.eq("code", args.code))
		.unique();
	if (!coupon) {
		return { error: "NOT_FOUND" };
	}

	const customer = await ctx.db.get(coupon.customerId);
	if (!customer || customer.organizationId !== args.organizationId) {
		return { error: "NOT_FOUND" };
	}
	if (coupon.status === "REDEEMED") {
		return { error: "ALREADY_REDEEMED" };
	}
	if (coupon.status === "EXPIRED" || coupon.status === "CANCELLED") {
		return { error: "NOT_REDEEMABLE" };
	}
	if (coupon.expiresAt <= Date.now()) {
		await ctx.db.patch(coupon._id, { status: "EXPIRED" });
		return { error: "EXPIRED" };
	}

	await ctx.db.patch(coupon._id, { status: "REDEEMED", redeemedAt: Date.now() });
	return { ok: true, couponInstanceId: coupon._id };
}
