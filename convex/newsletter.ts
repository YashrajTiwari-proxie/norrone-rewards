import { v, ConvexError } from "convex/values";
import { mutation, internalMutation, internalQuery, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { platformQuery, platformMutation, platformAction, orgStaffQuery, orgStaffMutation, orgStaffAction } from "./lib/authz";
import { rateLimiter } from "./lib/rateLimit";
import { sendEmail } from "./lib/email";
import { renderBlocksToHtml, DEFAULT_TEMPLATE_BLOCKS, type EmailBlock } from "./lib/emailBlocks";
import { computeOrgAudience, type AudienceFilter } from "./lib/audience";
import { generateCouponCode } from "./lib/loyaltyEngine";

const audienceValidator = v.object({
	tierIds: v.optional(v.array(v.id("tiers"))),
	membershipPlanIds: v.optional(v.array(v.id("membershipPlans"))),
	pointsMin: v.optional(v.number()),
	pointsMax: v.optional(v.number()),
	customerIds: v.optional(v.array(v.id("customers")))
});

/**
 * Marketing newsletter: subscribers, reusable block-based templates, and
 * batch-scheduled campaigns. See plan.md's "Email campaigns / newsletter"
 * section for the full design this implements.
 *
 * Used both by the platform admin (Norrone's own marketing list, campaigns
 * with organizationId undefined, recipients drawn from
 * newsletterSubscribers) and by any organization's own staff (campaigns
 * with organizationId set, recipients drawn from that org's customers).
 * Every public function below comes in a platform-scoped and an
 * org-scoped flavor that share one handler, keyed on
 * `organizationId: Id<"organizations"> | undefined`. Sending identity is
 * always the one shared EMAIL_FROM regardless of tenant — no per-org
 * "from" address, ever.
 *
 * Sending is entirely self-driven via ctx.scheduler (runAt to kick a
 * campaign off at its scheduledAt, runAfter for each batch to reschedule
 * itself) — the same deferred-scheduling pattern convex/engine.ts and
 * convex/customerGrants.ts already use for wallet push updates. No cron
 * file needed; nothing runs until a campaign is actually scheduled.
 */

const siteUrl = () => process.env.SITE_URL ?? "http://127.0.0.1:5173";

function normalizeEmail(raw: string): string {
	return raw.trim().toLowerCase();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generateToken(): string {
	return crypto.randomUUID().replace(/-/g, "");
}

// --- Public: subscribe / unsubscribe ------------------------------------

export const subscribe = mutation({
	args: { email: v.string(), source: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const email = normalizeEmail(args.email);
		if (!EMAIL_RE.test(email)) {
			throw new ConvexError({ code: "INVALID_EMAIL", message: "That doesn't look like a valid email address." });
		}

		try {
			await rateLimiter.limit(ctx, "newsletterSubscribe", { key: email, throws: true });
		} catch {
			throw new ConvexError({
				code: "RATE_LIMITED",
				message: "Too many attempts for this email. Please try again later."
			});
		}

		const existing = await ctx.db
			.query("newsletterSubscribers")
			.withIndex("by_email", (q) => q.eq("email", email))
			.unique();

		if (existing && existing.status === "subscribed") {
			// Already subscribed — no-op rather than resetting timestamps or
			// re-sending a welcome email (would let the form be used to spam
			// one address with repeat emails).
			return { subscribed: true as const };
		}

		let subscriberId: Id<"newsletterSubscribers">;
		if (existing) {
			// Genuine re-subscribe after having opted out.
			await ctx.db.patch(existing._id, {
				status: "subscribed",
				subscribedAt: Date.now(),
				unsubscribedAt: undefined
			});
			subscriberId = existing._id;
		} else {
			subscriberId = await ctx.db.insert("newsletterSubscribers", {
				email,
				status: "subscribed",
				source: args.source,
				unsubscribeToken: generateToken(),
				subscribedAt: Date.now()
			});
		}

		// Email delivery is best-effort — the subscription itself already
		// committed, matching convex/staff.ts's invite-email pattern.
		await ctx.scheduler.runAfter(0, internal.newsletter.sendWelcomeEmail, { subscriberId });

		return { subscribed: true as const };
	}
});

export const sendWelcomeEmail = internalAction({
	args: { subscriberId: v.id("newsletterSubscribers") },
	handler: async (ctx, args) => {
		const subscriber = await ctx.runQuery(internal.newsletter.getSubscriber, { subscriberId: args.subscriberId });
		if (!subscriber) return;

		const unsubscribeUrl = `${siteUrl()}/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`;
		const html = renderBlocksToHtml(
			[
				{ type: "heading", text: "You're subscribed" },
				{
					type: "paragraph",
					text: "Thanks for subscribing to Norrone Rewards updates — we'll only email you when there's something worth reading."
				}
			],
			{ unsubscribeUrl }
		);

		try {
			await sendEmail({ to: subscriber.email, subject: "You're subscribed to Norrone Rewards", html });
		} catch (err) {
			console.error("Failed to send newsletter welcome email", err);
		}
	}
});

export const getSubscriber = internalQuery({
	args: { subscriberId: v.id("newsletterSubscribers") },
	handler: async (ctx, args) => ctx.db.get(args.subscriberId)
});

export const unsubscribeByToken = mutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const subscriber = await ctx.db
			.query("newsletterSubscribers")
			.withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", args.token))
			.unique();
		if (!subscriber) return { found: false as const };

		if (subscriber.status !== "unsubscribed") {
			await ctx.db.patch(subscriber._id, { status: "unsubscribed", unsubscribedAt: Date.now() });
		}
		return { found: true as const };
	}
});

// --- Platform admin: subscribers -----------------------------------------

export const subscriberStats = platformQuery("newsletter:read")({
	args: {},
	handler: async (ctx) => {
		const all = await ctx.db.query("newsletterSubscribers").collect();
		return {
			total: all.length,
			subscribed: all.filter((s) => s.status === "subscribed").length,
			unsubscribed: all.filter((s) => s.status === "unsubscribed").length,
			bounced: all.filter((s) => s.status === "bounced").length
		};
	}
});

export const listSubscribers = platformQuery("newsletter:read")({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const rows = await ctx.db.query("newsletterSubscribers").order("desc").take(args.limit ?? 200);
		return rows.map((r) => ({
			id: r._id,
			email: r.email,
			status: r.status,
			source: r.source ?? null,
			subscribedAt: r.subscribedAt
		}));
	}
});

// --- Org: recipient count ----------------------------------------------

export const orgRecipientStats = orgStaffQuery("newsletter:read")({
	args: {},
	handler: async (ctx) => {
		const customers = await ctx.db
			.query("customers")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		const emails = new Set(
			customers.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => Boolean(e))
		);
		const withoutEmail = customers.filter((c) => !c.email?.trim()).length;
		return { recipients: emails.size, customersWithoutEmail: withoutEmail };
	}
});

/**
 * Search box for the campaign editor's "specific customers" audience
 * picker — separate from customers.list (used by the Customers page)
 * because that query never returns email, and only an emailed customer is
 * a candidate recipient here anyway.
 */
export const searchOrgCustomers = orgStaffQuery("newsletter:read")({
	args: { search: v.string() },
	handler: async (ctx, args) => {
		const needle = args.search.trim().toLowerCase();
		if (!needle) return [];
		const customers = await ctx.db
			.query("customers")
			.withIndex("by_organization", (q) => q.eq("organizationId", ctx.organizationId))
			.collect();
		return customers
			.filter((c) => c.email?.trim())
			.filter(
				(c) =>
					c.name?.toLowerCase().includes(needle) ||
					c.externalId.toLowerCase().includes(needle) ||
					c.email!.toLowerCase().includes(needle)
			)
			.slice(0, 20)
			.map((c) => ({ id: c._id, name: c.name ?? c.externalId, email: c.email! }));
	}
});

/** Hydrates name/email for a saved audience's customerIds, for the editor's chip display on load. */
export const resolveOrgCustomers = orgStaffQuery("newsletter:read")({
	args: { customerIds: v.array(v.id("customers")) },
	handler: async (ctx, args) => {
		const rows = await Promise.all(args.customerIds.map((id) => ctx.db.get(id)));
		return rows
			.filter((c): c is NonNullable<typeof c> => c !== null && c.organizationId === ctx.organizationId)
			.map((c) => ({ id: c._id, name: c.name ?? c.externalId, email: c.email ?? "" }));
	}
});

// --- Templates (platform + org) --------------------------------------------

async function listTemplatesHandler(ctx: QueryCtx, organizationId: Id<"organizations"> | undefined) {
	const rows = (await ctx.db.query("emailTemplates").collect()).filter((r) => r.organizationId === organizationId);
	rows.sort((a, b) => b._creationTime - a._creationTime);
	return rows.map((r) => ({ id: r._id, name: r.name, isDefault: r.isDefault ?? false, updatedAt: r.updatedAt }));
}

async function getTemplateHandler(
	ctx: QueryCtx,
	organizationId: Id<"organizations"> | undefined,
	templateId: Id<"emailTemplates">
) {
	const template = await ctx.db.get(templateId);
	if (!template || template.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Template not found." });
	}
	return { id: template._id, name: template.name, blocks: template.blocks as EmailBlock[] };
}

async function saveTemplateHandler(
	ctx: MutationCtx,
	organizationId: Id<"organizations"> | undefined,
	args: { templateId?: Id<"emailTemplates">; name: string; blocks: unknown[] }
) {
	if (args.templateId) {
		const existing = await ctx.db.get(args.templateId);
		if (!existing || existing.organizationId !== organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Template not found." });
		}
		await ctx.db.patch(args.templateId, { name: args.name, blocks: args.blocks, updatedAt: Date.now() });
		return { templateId: args.templateId };
	}
	const templateId = await ctx.db.insert("emailTemplates", {
		organizationId,
		name: args.name,
		blocks: args.blocks,
		updatedAt: Date.now()
	});
	return { templateId };
}

export const listTemplates = platformQuery("newsletter:read")({
	args: {},
	handler: (ctx) => listTemplatesHandler(ctx, undefined)
});
export const listOrgTemplates = orgStaffQuery("newsletter:read")({
	args: {},
	handler: (ctx) => listTemplatesHandler(ctx, ctx.organizationId)
});

export const getTemplate = platformQuery("newsletter:read")({
	args: { templateId: v.id("emailTemplates") },
	handler: (ctx, args) => getTemplateHandler(ctx, undefined, args.templateId)
});
export const getOrgTemplate = orgStaffQuery("newsletter:read")({
	args: { templateId: v.id("emailTemplates") },
	handler: (ctx, args) => getTemplateHandler(ctx, ctx.organizationId, args.templateId)
});

export const saveTemplate = platformMutation("newsletter:write")({
	args: { templateId: v.optional(v.id("emailTemplates")), name: v.string(), blocks: v.array(v.any()) },
	handler: (ctx, args) => saveTemplateHandler(ctx, undefined, args)
});
export const saveOrgTemplate = orgStaffMutation("newsletter:write")({
	args: { templateId: v.optional(v.id("emailTemplates")), name: v.string(), blocks: v.array(v.any()) },
	handler: (ctx, args) => saveTemplateHandler(ctx, ctx.organizationId, args)
});

// --- Campaigns (platform + org) ---------------------------------------------

function campaignSummary(r: {
	_id: Id<"campaigns">;
	kind: "newsletter" | "promotion";
	subject: string;
	status: string;
	scheduledAt?: number;
	sentAt?: number;
	totalRecipients?: number;
	sentCount?: number;
	failedCount?: number;
}) {
	return {
		id: r._id,
		kind: r.kind,
		subject: r.subject,
		status: r.status,
		scheduledAt: r.scheduledAt ?? null,
		sentAt: r.sentAt ?? null,
		totalRecipients: r.totalRecipients ?? 0,
		sentCount: r.sentCount ?? 0,
		failedCount: r.failedCount ?? 0
	};
}

async function listCampaignsHandler(ctx: QueryCtx, organizationId: Id<"organizations"> | undefined) {
	const rows = (await ctx.db.query("campaigns").collect()).filter((r) => r.organizationId === organizationId);
	rows.sort((a, b) => b._creationTime - a._creationTime);
	return rows.map(campaignSummary);
}

async function getCampaignHandler(
	ctx: QueryCtx,
	organizationId: Id<"organizations"> | undefined,
	campaignId: Id<"campaigns">
) {
	const campaign = await ctx.db.get(campaignId);
	if (!campaign || campaign.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
	}
	return {
		id: campaign._id,
		kind: campaign.kind,
		subject: campaign.subject,
		blocks: campaign.blocks as EmailBlock[],
		status: campaign.status,
		audience: campaign.audience ?? null,
		scheduledAt: campaign.scheduledAt ?? null,
		sentAt: campaign.sentAt ?? null,
		batchSize: campaign.batchSize,
		batchIntervalMs: campaign.batchIntervalMs,
		totalRecipients: campaign.totalRecipients ?? 0,
		sentCount: campaign.sentCount ?? 0,
		failedCount: campaign.failedCount ?? 0
	};
}

async function createCampaignHandler(
	ctx: MutationCtx & { authUserId: string },
	organizationId: Id<"organizations"> | undefined,
	args: { subject: string; kind: "newsletter" | "promotion"; templateId?: Id<"emailTemplates"> }
) {
	const template = args.templateId ? await ctx.db.get(args.templateId) : null;
	const blocks = template && template.organizationId === organizationId ? template.blocks : DEFAULT_TEMPLATE_BLOCKS;
	const campaignId = await ctx.db.insert("campaigns", {
		organizationId,
		kind: args.kind,
		subject: args.subject,
		blocks,
		status: "draft",
		batchSize: 50,
		batchIntervalMs: 3000,
		createdBy: ctx.authUserId
	});
	return { campaignId };
}

async function updateCampaignHandler(
	ctx: MutationCtx,
	organizationId: Id<"organizations"> | undefined,
	args: {
		campaignId: Id<"campaigns">;
		subject: string;
		blocks: unknown[];
		batchSize?: number;
		batchIntervalMs?: number;
		audience?: AudienceFilter;
	}
) {
	const campaign = await ctx.db.get(args.campaignId);
	if (!campaign || campaign.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
	}
	if (campaign.status !== "draft") {
		throw new ConvexError({ code: "NOT_DRAFT", message: "Only a draft campaign can be edited." });
	}
	await ctx.db.patch(args.campaignId, {
		subject: args.subject,
		blocks: args.blocks,
		...(args.batchSize ? { batchSize: args.batchSize } : {}),
		...(args.batchIntervalMs ? { batchIntervalMs: args.batchIntervalMs } : {}),
		...(args.audience !== undefined ? { audience: args.audience } : {})
	});
}

async function scheduleCampaignHandler(
	ctx: MutationCtx,
	organizationId: Id<"organizations"> | undefined,
	args: { campaignId: Id<"campaigns">; scheduledAt: number }
) {
	const campaign = await ctx.db.get(args.campaignId);
	if (!campaign || campaign.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
	}
	if (campaign.status !== "draft") {
		throw new ConvexError({ code: "NOT_DRAFT", message: "Only a draft campaign can be scheduled." });
	}
	if (!campaign.subject.trim()) {
		throw new ConvexError({ code: "NO_SUBJECT", message: "Give the campaign a subject line first." });
	}
	await ctx.db.patch(args.campaignId, { status: "scheduled", scheduledAt: args.scheduledAt });
	await ctx.scheduler.runAt(args.scheduledAt, internal.newsletter.startSending, { campaignId: args.campaignId });
}

async function cancelCampaignHandler(
	ctx: MutationCtx,
	organizationId: Id<"organizations"> | undefined,
	campaignId: Id<"campaigns">
) {
	const campaign = await ctx.db.get(campaignId);
	if (!campaign || campaign.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
	}
	if (campaign.status !== "scheduled") {
		throw new ConvexError({ code: "NOT_SCHEDULED", message: "Only a scheduled campaign can be canceled." });
	}
	// The scheduler job still fires at scheduledAt — startSending guards
	// on status itself (see below) so this alone is enough to stop it
	// from actually sending.
	await ctx.db.patch(campaignId, { status: "canceled" });
}

/**
 * Not allowed while "sending" — not because it's unsafe (processBatch and
 * startSending both already guard on `!campaign`, so a mid-flight delete
 * can't double-send or crash), just so a campaign doesn't vanish out from
 * under someone watching its live sentCount/failedCount. Any other status
 * (draft/scheduled/canceled/sent) is fine — a scheduled campaign's pending
 * scheduler job is a no-op once the row is gone, same guard.
 */
async function deleteCampaignHandler(
	ctx: MutationCtx,
	organizationId: Id<"organizations"> | undefined,
	campaignId: Id<"campaigns">
) {
	const campaign = await ctx.db.get(campaignId);
	if (!campaign || campaign.organizationId !== organizationId) {
		throw new ConvexError({ code: "NOT_FOUND", message: "Campaign not found." });
	}
	if (campaign.status === "sending") {
		throw new ConvexError({ code: "SENDING", message: "Can't delete a campaign while it's sending." });
	}

	const recipients = await ctx.db
		.query("campaignRecipients")
		.withIndex("by_campaign_and_status", (q) => q.eq("campaignId", campaignId))
		.collect();
	for (const r of recipients) {
		await ctx.db.delete(r._id);
	}
	await ctx.db.delete(campaignId);
}

async function sendTestEmailHandler(args: { subject: string; blocks: unknown[]; to: string }) {
	const html = renderBlocksToHtml(args.blocks as EmailBlock[], {
		unsubscribeUrl: `${siteUrl()}/newsletter/unsubscribe?token=test`
	});
	await sendEmail({ to: args.to, subject: `[Test] ${args.subject}`, html });
}

export const listCampaigns = platformQuery("newsletter:read")({
	args: {},
	handler: (ctx) => listCampaignsHandler(ctx, undefined)
});
export const listOrgCampaigns = orgStaffQuery("newsletter:read")({
	args: {},
	handler: (ctx) => listCampaignsHandler(ctx, ctx.organizationId)
});

export const getCampaign = platformQuery("newsletter:read")({
	args: { campaignId: v.id("campaigns") },
	handler: (ctx, args) => getCampaignHandler(ctx, undefined, args.campaignId)
});
export const getOrgCampaign = orgStaffQuery("newsletter:read")({
	args: { campaignId: v.id("campaigns") },
	handler: (ctx, args) => getCampaignHandler(ctx, ctx.organizationId, args.campaignId)
});

export const createCampaign = platformMutation("newsletter:write")({
	args: {
		subject: v.string(),
		kind: v.union(v.literal("newsletter"), v.literal("promotion")),
		templateId: v.optional(v.id("emailTemplates"))
	},
	handler: (ctx, args) => createCampaignHandler(ctx, undefined, args)
});
export const createOrgCampaign = orgStaffMutation("newsletter:write")({
	args: {
		subject: v.string(),
		kind: v.union(v.literal("newsletter"), v.literal("promotion")),
		templateId: v.optional(v.id("emailTemplates"))
	},
	handler: (ctx, args) => createCampaignHandler(ctx, ctx.organizationId, args)
});

export const updateCampaign = platformMutation("newsletter:write")({
	args: {
		campaignId: v.id("campaigns"),
		subject: v.string(),
		blocks: v.array(v.any()),
		batchSize: v.optional(v.number()),
		batchIntervalMs: v.optional(v.number())
	},
	handler: (ctx, args) => updateCampaignHandler(ctx, undefined, args)
});
export const updateOrgCampaign = orgStaffMutation("newsletter:write")({
	args: {
		campaignId: v.id("campaigns"),
		subject: v.string(),
		blocks: v.array(v.any()),
		batchSize: v.optional(v.number()),
		batchIntervalMs: v.optional(v.number()),
		audience: v.optional(audienceValidator)
	},
	handler: (ctx, args) => updateCampaignHandler(ctx, ctx.organizationId, args)
});

/** Live recipient-count preview for whatever audience filter is currently set in the editor — not yet saved. */
export const previewOrgAudience = orgStaffQuery("newsletter:read")({
	args: { audience: audienceValidator },
	handler: async (ctx, args) => {
		const recipients = await computeOrgAudience(ctx, ctx.organizationId, args.audience);
		return { count: recipients.length };
	}
});

export const scheduleCampaign = platformMutation("newsletter:send")({
	args: { campaignId: v.id("campaigns"), scheduledAt: v.number() },
	handler: (ctx, args) => scheduleCampaignHandler(ctx, undefined, args)
});
export const scheduleOrgCampaign = orgStaffMutation("newsletter:send")({
	args: { campaignId: v.id("campaigns"), scheduledAt: v.number() },
	handler: (ctx, args) => scheduleCampaignHandler(ctx, ctx.organizationId, args)
});

export const cancelCampaign = platformMutation("newsletter:send")({
	args: { campaignId: v.id("campaigns") },
	handler: (ctx, args) => cancelCampaignHandler(ctx, undefined, args.campaignId)
});
export const cancelOrgCampaign = orgStaffMutation("newsletter:send")({
	args: { campaignId: v.id("campaigns") },
	handler: (ctx, args) => cancelCampaignHandler(ctx, ctx.organizationId, args.campaignId)
});

export const deleteCampaign = platformMutation("newsletter:write")({
	args: { campaignId: v.id("campaigns") },
	handler: (ctx, args) => deleteCampaignHandler(ctx, undefined, args.campaignId)
});
export const deleteOrgCampaign = orgStaffMutation("newsletter:write")({
	args: { campaignId: v.id("campaigns") },
	handler: (ctx, args) => deleteCampaignHandler(ctx, ctx.organizationId, args.campaignId)
});

export const sendTestEmail = platformAction("newsletter:send")({
	args: { subject: v.string(), blocks: v.array(v.any()), to: v.string() },
	handler: (_ctx, args) => sendTestEmailHandler(args)
});
export const sendOrgTestEmail = orgStaffAction("newsletter:send")({
	args: { subject: v.string(), blocks: v.array(v.any()), to: v.string() },
	handler: (_ctx, args) => sendTestEmailHandler(args)
});

// --- Sending engine (internal) ---------------------------------------------

export const startSending = internalMutation({
	args: { campaignId: v.id("campaigns") },
	handler: async (ctx, args) => {
		const campaign = await ctx.db.get(args.campaignId);
		// Guards a canceled-in-the-meantime campaign — its scheduler job
		// still fires at the original scheduledAt, this is what actually
		// stops it from sending.
		if (!campaign || campaign.status !== "scheduled") return;

		let recipientCount = 0;
		if (campaign.organizationId === undefined) {
			const subscribers = await ctx.db
				.query("newsletterSubscribers")
				.withIndex("by_status", (q) => q.eq("status", "subscribed"))
				.collect();
			for (const subscriber of subscribers) {
				await ctx.db.insert("campaignRecipients", {
					campaignId: args.campaignId,
					email: subscriber.email,
					subscriberId: subscriber._id,
					status: "pending"
				});
			}
			recipientCount = subscribers.length;
		} else {
			// Resolves the campaign's audience filter (tiers/plans/points/an
			// explicit customer list) — an empty filter falls back to every
			// customer with an email, same as before targeting existed.
			const recipients = await computeOrgAudience(ctx, campaign.organizationId, campaign.audience);
			for (const { customerId, email } of recipients) {
				await ctx.db.insert("campaignRecipients", {
					campaignId: args.campaignId,
					email,
					customerId,
					status: "pending"
				});
			}
			recipientCount = recipients.length;
		}

		await ctx.db.patch(args.campaignId, {
			status: "sending",
			totalRecipients: recipientCount,
			sentCount: 0,
			failedCount: 0
		});

		await ctx.scheduler.runAfter(0, internal.newsletter.processBatch, { campaignId: args.campaignId });
	}
});

export const getCampaignForSend = internalQuery({
	args: { campaignId: v.id("campaigns") },
	handler: async (ctx, args) => ctx.db.get(args.campaignId)
});

type PendingRecipient = {
	recipientId: Id<"campaignRecipients">;
	email: string;
	customerId: Id<"customers"> | null;
	subscriber: {
		status: "subscribed" | "unsubscribed" | "bounced";
		unsubscribeToken: string;
	} | null;
};

export const getPendingRecipients = internalQuery({
	args: { campaignId: v.id("campaigns"), limit: v.number() },
	handler: async (ctx, args): Promise<PendingRecipient[]> => {
		const rows = await ctx.db
			.query("campaignRecipients")
			.withIndex("by_campaign_and_status", (q) => q.eq("campaignId", args.campaignId).eq("status", "pending"))
			.take(args.limit);
		return Promise.all(
			rows.map(async (r) => ({
				recipientId: r._id,
				email: r.email,
				customerId: r.customerId ?? null,
				// Only a platform-list recipient can unsubscribe via token —
				// an org's customer isn't on newsletterSubscribers at all.
				subscriber: r.subscriberId ? await ctx.db.get(r.subscriberId) : null
			}))
		);
	}
});

/** Reward blocks are static — same content for every recipient — so this runs once per batch, not once per recipient. */
export const getRewardsByIds = internalQuery({
	args: { rewardIds: v.array(v.id("rewardDefinitions")) },
	handler: async (ctx, args) => {
		const rows = await Promise.all(args.rewardIds.map((id) => ctx.db.get(id)));
		const entries: [string, { name: string; description?: string }][] = [];
		for (const r of rows) {
			if (r) entries.push([r._id, { name: r.name, description: r.description }]);
		}
		return entries;
	}
});

/**
 * A coupon block mints (or reuses) a personal, unredeemed coupon instance
 * for the recipient — the whole point of putting a coupon in an email is
 * that it's this customer's own redeemable code, not a shared promo code.
 * Reuses an existing ISSUED, unexpired instance instead of minting a new
 * one every time the same campaign happens to be re-processed for this
 * recipient (retry, resumed batch).
 */
export const ensureCouponForRecipient = internalMutation({
	args: { customerId: v.id("customers"), couponDefinitionId: v.id("couponDefinitions") },
	handler: async (ctx, args) => {
		const couponDef = await ctx.db.get(args.couponDefinitionId);
		if (!couponDef) return null;

		const existing = await ctx.db
			.query("couponInstances")
			.withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
			.filter((q) => q.eq(q.field("couponDefinitionId"), args.couponDefinitionId))
			.filter((q) => q.eq(q.field("status"), "ISSUED"))
			.first();
		if (existing && existing.expiresAt > Date.now()) {
			return {
				code: existing.code,
				discountValue: couponDef.discountValue,
				discountType: couponDef.discountType,
				expiresAt: existing.expiresAt
			};
		}

		const code = await generateCouponCode(ctx);
		const expiresAt = Date.now() + couponDef.validityDays * 24 * 60 * 60 * 1000;
		await ctx.db.insert("couponInstances", {
			customerId: args.customerId,
			couponDefinitionId: args.couponDefinitionId,
			code,
			status: "ISSUED",
			expiresAt
		});
		return { code, discountValue: couponDef.discountValue, discountType: couponDef.discountType, expiresAt };
	}
});

export const countPendingRecipients = internalQuery({
	args: { campaignId: v.id("campaigns") },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("campaignRecipients")
			.withIndex("by_campaign_and_status", (q) => q.eq("campaignId", args.campaignId).eq("status", "pending"))
			.collect();
		return rows.length;
	}
});

export const recordBatchResults = internalMutation({
	args: {
		campaignId: v.id("campaigns"),
		results: v.array(v.object({ recipientId: v.id("campaignRecipients"), ok: v.boolean(), error: v.optional(v.string()) }))
	},
	handler: async (ctx, args) => {
		let sent = 0;
		let failed = 0;
		for (const r of args.results) {
			await ctx.db.patch(r.recipientId, {
				status: r.ok ? "sent" : "failed",
				error: r.error,
				sentAt: r.ok ? Date.now() : undefined
			});
			if (r.ok) sent++;
			else failed++;
		}
		const campaign = await ctx.db.get(args.campaignId);
		if (campaign) {
			await ctx.db.patch(args.campaignId, {
				sentCount: (campaign.sentCount ?? 0) + sent,
				failedCount: (campaign.failedCount ?? 0) + failed
			});
		}
	}
});

export const finalizeCampaign = internalMutation({
	args: { campaignId: v.id("campaigns") },
	handler: async (ctx, args) => {
		const campaign = await ctx.db.get(args.campaignId);
		if (!campaign || campaign.status !== "sending") return;
		await ctx.db.patch(args.campaignId, { status: "sent", sentAt: Date.now() });
	}
});

export const processBatch = internalAction({
	args: { campaignId: v.id("campaigns") },
	handler: async (ctx, args) => {
		const campaign = await ctx.runQuery(internal.newsletter.getCampaignForSend, { campaignId: args.campaignId });
		// A campaign can only reach "sending" via startSending, and nothing
		// currently moves it out of "sending" mid-flight — this guard is
		// just cheap insurance against a stray duplicate scheduler call.
		if (!campaign || campaign.status !== "sending") return;

		const batch = await ctx.runQuery(internal.newsletter.getPendingRecipients, {
			campaignId: args.campaignId,
			limit: campaign.batchSize
		});

		const blocks = campaign.blocks as EmailBlock[];
		const rewardIds = [...new Set(blocks.filter((b) => b.type === "reward").map((b) => b.rewardId))] as Id<"rewardDefinitions">[];
		const couponDefIds = [
			...new Set(blocks.filter((b) => b.type === "coupon").map((b) => b.couponDefinitionId))
		] as Id<"couponDefinitions">[];
		// Reward content is the same for every recipient — resolved once per
		// batch, not once per recipient (unlike coupons, which are personal).
		const rewards =
			rewardIds.length > 0
				? Object.fromEntries(await ctx.runQuery(internal.newsletter.getRewardsByIds, { rewardIds }))
				: undefined;

		const results = await Promise.all(
			batch.map(async ({ recipientId, email, customerId, subscriber }) => {
				// Platform-list recipients: skip if they unsubscribed after this
				// batch was queued. Org-customer recipients have no such flag today.
				if (subscriber && subscriber.status !== "subscribed") {
					return { recipientId, ok: false, error: "No longer subscribed" };
				}
				try {
					const unsubscribeUrl = subscriber
						? `${siteUrl()}/newsletter/unsubscribe?token=${subscriber.unsubscribeToken}`
						: undefined;
					let coupons: Record<string, { code: string; discountValue: number; discountType: "PERCENTAGE" | "FIXED"; expiresAt: number }> | undefined;
					if (couponDefIds.length > 0 && customerId) {
						coupons = {};
						for (const couponDefinitionId of couponDefIds) {
							const coupon = await ctx.runMutation(internal.newsletter.ensureCouponForRecipient, {
								customerId,
								couponDefinitionId
							});
							if (coupon) coupons[couponDefinitionId] = coupon;
						}
					}
					const html = renderBlocksToHtml(blocks, { unsubscribeUrl, rewards, coupons });
					await sendEmail({ to: email, subject: campaign.subject, html });
					return { recipientId, ok: true as const };
				} catch (err) {
					return { recipientId, ok: false as const, error: err instanceof Error ? err.message : "Send failed" };
				}
			})
		);

		await ctx.runMutation(internal.newsletter.recordBatchResults, { campaignId: args.campaignId, results });

		const remaining = await ctx.runQuery(internal.newsletter.countPendingRecipients, { campaignId: args.campaignId });
		if (remaining > 0) {
			await ctx.scheduler.runAfter(campaign.batchIntervalMs, internal.newsletter.processBatch, {
				campaignId: args.campaignId
			});
		} else {
			await ctx.runMutation(internal.newsletter.finalizeCampaign, { campaignId: args.campaignId });
		}
	}
});
