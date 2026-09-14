import { v, ConvexError } from "convex/values";
import { internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { orgStaffAction, orgStaffQuery } from "./lib/authz";
import { signWalletToken } from "./lib/walletSigning";

/**
 * Wallet-pass data + config-status surface for the org dashboard. Actual
 * pass building/signing lives in convex/walletNode.ts ("use node", needed
 * for node-forge's PKCS#7 signing) and is only ever reached via the
 * signed-token HTTP endpoints in convex/httpWallet.ts — nothing here
 * exposes cert/key material to the client, only whether each platform is
 * configured.
 */

const DEFAULT_PASS_DESIGN = {
	backgroundColor: "rgb(27,36,48)", // --ink
	foregroundColor: "rgb(255,255,255)"
};

/** Everything a pass (Apple or Google) needs to render — shared by both builders. */
export const getPassData = internalQuery({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found" });

		const organization = await ctx.db.get(customer.organizationId);
		if (!organization) throw new ConvexError({ code: "NOT_FOUND", message: "Organization not found" });

		const ledgerRows = await ctx.db
			.query("pointLedger")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.collect();
		const pointBalance = ledgerRows.reduce((sum, row) => sum + row.amount, 0);

		const tierRow = await ctx.db
			.query("customerTier")
			.withIndex("by_customer", (q) => q.eq("customerId", customer._id))
			.order("desc")
			.first();
		const tierDoc = tierRow ? await ctx.db.get(tierRow.tierId) : null;

		const template = await ctx.db
			.query("passTemplates")
			.withIndex("by_organization", (q) => q.eq("organizationId", organization._id))
			.filter((q) => q.eq(q.field("shopId"), undefined))
			.first();

		return {
			customerId: customer._id as string,
			customerName: customer.name ?? customer.externalId,
			organizationName: template?.organizationDisplayName ?? organization.name,
			pointBalance,
			tierName: tierDoc?.name ?? null,
			backgroundColor: template?.backgroundColor ?? DEFAULT_PASS_DESIGN.backgroundColor,
			foregroundColor: template?.foregroundColor ?? DEFAULT_PASS_DESIGN.foregroundColor,
			logoUrl: template?.logoUrl ?? null,
			iconUrl: template?.iconUrl ?? null
		};
	}
});

/** Which platforms have real credentials configured — read by the dashboard, never returns the secrets themselves. */
export const configStatus = orgStaffQuery("passTemplates:read")({
	args: {},
	handler: async () => ({
		apple: Boolean(
			process.env.APPLE_PASS_TYPE_ID &&
				process.env.APPLE_TEAM_ID &&
				process.env.APPLE_PASS_CERT_PEM &&
				process.env.APPLE_PASS_KEY_PEM &&
				process.env.APPLE_WWDR_CERT_PEM
		),
		google: Boolean(process.env.GOOGLE_WALLET_ISSUER_ID && process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON)
	})
});

/**
 * Signs a short-lived token for one customer's wallet pass. Org-permission-
 * checked (same "can read this customer" bar as the customer detail page)
 * — the token itself carries no further auth beyond its own
 * signature+expiry, so the caller builds `${PUBLIC_CONVEX_SITE_URL}/v1/wallet/{apple,google}/${token}`
 * (PUBLIC_CONVEX_SITE_URL is a frontend-side env var, not visible to
 * Convex functions, hence returning the bare token rather than a full URL).
 */
export const getPassLinkToken = orgStaffAction("customers:read")({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const customer = await ctx.runQuery(internal.wallet.getCustomerOrgId, { customerId: args.customerId });
		if (!customer || customer.organizationId !== ctx.organizationId) {
			throw new ConvexError({ code: "NOT_FOUND", message: "Customer not found in this organization" });
		}

		return { token: await signWalletToken(args.customerId) };
	}
});

export const getCustomerOrgId = internalQuery({
	args: { customerId: v.id("customers") },
	handler: async (ctx, args) => {
		const customer = await ctx.db.get(args.customerId);
		return customer ? { organizationId: customer.organizationId } : null;
	}
});
