#!/usr/bin/env bun
/**
 * Example client for the Norrone Rewards public API — see ../docs/API.md
 * for the full reference. This file is meant to be read as documentation
 * as much as run: a minimal `NorroneClient` wrapper, followed by a
 * walkthrough of the common integration flow a website/POS would follow
 * (create customer → record a purchase → check offers → redeem a coupon).
 *
 * Usage:
 *   NORRONE_BASE_URL=https://your-deployment.convex.site \
 *   NORRONE_API_KEY=sk_... \
 *   NORRONE_SHOP_ID=<shop id from the dashboard> \
 *     bun run examples/api-client.ts
 *
 * Works with plain `fetch` — no SDK dependency. Runnable with Bun, Node
 * 18+, or Deno with trivial changes (only `Bun.argv`-style env reading
 * would need adjusting, and there is none here — `process.env` works
 * everywhere).
 */

type CustomerView = {
	externalId: string;
	isMember: boolean;
	membership: { planName: string; expiresAt: number } | null;
	tier: { name: string; level: number } | null;
	pointBalance: number;
	rewards: Array<{ name: string; grantedAt: number }>;
	coupons: Array<{ code: string; status: string; expiresAt: number }>;
};

type UpdateStatsResult = CustomerView & {
	newlyGranted?: {
		tier: { name: string } | null;
		rewards: Array<{ id: string; name: string }>;
		coupons: Array<{ code: string; status: string }>;
	};
};

class NorroneApiError extends Error {
	constructor(
		public status: number,
		public body: unknown
	) {
		super(`Norrone API error ${status}: ${JSON.stringify(body)}`);
	}
}

class NorroneClient {
	constructor(
		private baseUrl: string,
		private apiKey: string
	) {}

	private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await fetch(new URL(path, this.baseUrl), {
			...init,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
				...init.headers
			}
		});
		const body = await response.json().catch(() => null);
		if (!response.ok) throw new NorroneApiError(response.status, body);
		return body as T;
	}

	/** Creates a customer. Requires a secret key. 409s if externalId already exists for this shop. */
	createCustomer(
		shopId: string,
		customer: { externalId: string; name?: string; phone?: string; email?: string }
	): Promise<CustomerView> {
		return this.request(`/v1/shops/${shopId}/customers`, { method: "POST", body: JSON.stringify(customer) });
	}

	/** Fetches a customer. Works with a publishable key. */
	getCustomer(shopId: string, externalId: string): Promise<CustomerView> {
		return this.request(`/v1/shops/${shopId}/customers/${encodeURIComponent(externalId)}`);
	}

	/**
	 * Records an event — a purchase, a visit, whatever your point rules key
	 * off of — and returns any tier/reward/coupon that just got granted as
	 * a result. Requires a secret key. Pass a stable `idempotencyKey` (e.g.
	 * your own order ID) so a retried request never double-applies.
	 */
	updateCustomerStats(
		shopId: string,
		externalId: string,
		update: { deltaSpend?: number; deltaVisits?: number; action?: string; idempotencyKey?: string }
	): Promise<UpdateStatsResult> {
		return this.request(`/v1/shops/${shopId}/customers/${encodeURIComponent(externalId)}`, {
			method: "PUT",
			body: JSON.stringify(update)
		});
	}

	/** Enrolls a customer in a paid membership plan. Requires a secret key. */
	enrollMembership(
		shopId: string,
		externalId: string,
		planId: string,
		idempotencyKey?: string
	): Promise<CustomerView> {
		return this.request(`/v1/shops/${shopId}/customers/${encodeURIComponent(externalId)}/membership`, {
			method: "POST",
			body: JSON.stringify({ planId, idempotencyKey })
		});
	}

	/** Personalized offers for one customer. Works with a publishable key. */
	getPersonalizedOffers(shopId: string, externalId: string) {
		return this.request(`/v1/shops/${shopId}/customers/${encodeURIComponent(externalId)}/offers`);
	}

	/** Public, non-personalized offers for a shop — safe to render on a marketing page. */
	getPublicOffers(shopId: string) {
		return this.request(`/v1/shops/${shopId}/offers`);
	}

	/** Redeems a coupon at the point of sale. Requires a secret key. */
	redeemCoupon(code: string): Promise<{ redeemed: true }> {
		return this.request(`/v1/coupons/${encodeURIComponent(code)}/redeem`, { method: "POST" });
	}
}

// --- Example walkthrough ----------------------------------------------------

async function main() {
	const baseUrl = process.env.NORRONE_BASE_URL;
	const apiKey = process.env.NORRONE_API_KEY;
	const shopId = process.env.NORRONE_SHOP_ID;

	if (!baseUrl || !apiKey || !shopId) {
		console.error(
			"Set NORRONE_BASE_URL, NORRONE_API_KEY, and NORRONE_SHOP_ID (see the header comment in this file)."
		);
		process.exit(1);
	}

	const client = new NorroneClient(baseUrl, apiKey);
	const externalId = `example-${Date.now()}`;

	console.log(`Creating customer ${externalId}...`);
	const created = await client.createCustomer(shopId, {
		externalId,
		name: "Ada Lovelace",
		email: "ada@example.com"
	});
	console.log(created);

	console.log("\nRecording a $50 purchase (action=PURCHASE)...");
	const afterPurchase = await client.updateCustomerStats(shopId, externalId, {
		deltaSpend: 50,
		deltaVisits: 1,
		action: "PURCHASE",
		idempotencyKey: `example-order-${Date.now()}`
	});
	console.log(afterPurchase);
	if (afterPurchase.newlyGranted?.tier) {
		console.log(`🎉 Just reached tier: ${afterPurchase.newlyGranted.tier.name}`);
	}

	console.log("\nFetching personalized offers...");
	console.log(await client.getPersonalizedOffers(shopId, externalId));

	console.log("\nFetching this shop's public offers...");
	console.log(await client.getPublicOffers(shopId));

	// Redeeming a coupon requires one to actually exist for this customer
	// (issued either automatically via a tier/reward grant above, or
	// manually from the dashboard) — shown here as a try/catch since this
	// walkthrough's fresh customer won't have one yet.
	try {
		console.log("\nAttempting to redeem a coupon (expected to fail — none issued yet)...");
		await client.redeemCoupon("SOME-CODE-THIS-CUSTOMER-DOES-NOT-HAVE");
	} catch (err) {
		if (err instanceof NorroneApiError) {
			console.log(`(expected) redeem failed with ${err.status}: ${JSON.stringify(err.body)}`);
		} else {
			throw err;
		}
	}
}

if (import.meta.main) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

export { NorroneClient, NorroneApiError };
export type { CustomerView, UpdateStatsResult };
