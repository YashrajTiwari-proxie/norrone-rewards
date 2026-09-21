<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import IdLine from '$lib/components/IdLine.svelte';
	import { page } from '$app/state';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));
	const plans = useQuery(api.membershipPlans.list, () => ({ organizationId }));

	// This app's own domain — every example below uses it, not a raw
	// Convex URL, since src/routes/v1/[...path]/+server.ts transparently
	// proxies /v1/... through to the backend. Devs integrating against
	// this API never need to know what's running behind it.
	let baseUrl = $derived(`${page.url.origin}/v1`);

	let exampleShopId = $derived(org.data?.shops[0]?._id ?? 'SHOP_ID');
	let examplePlanId = $derived(plans.data?.[0]?._id ?? 'PLAN_ID');

	type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
	const methodTone: Record<Method, 'green' | 'amber' | 'grey' | 'rust'> = {
		GET: 'green',
		POST: 'amber',
		PUT: 'grey',
		DELETE: 'rust'
	};

	type Row = { method: Method; path: string; desc: string; key: 'secret' | 'either' };
	let customerRows = $derived<Row[]>([
		{ method: 'POST', path: `/shops/${exampleShopId}/customers`, desc: 'Create a customer. externalId is required, unique per shop.', key: 'secret' },
		{ method: 'GET', path: `/shops/${exampleShopId}/customers/:externalId`, desc: 'Fetch one customer.', key: 'either' },
		{ method: 'PUT', path: `/shops/${exampleShopId}/customers/:externalId/profile`, desc: 'Update name / phone / email.', key: 'secret' },
		{ method: 'DELETE', path: `/shops/${exampleShopId}/customers/:externalId`, desc: 'Delete a customer and every row that references them. Cannot be undone.', key: 'secret' },
		{ method: 'PUT', path: `/shops/${exampleShopId}/customers/:externalId`, desc: 'Record an event: adjust spend/visits, award points for a named action, re-check eligibility.', key: 'secret' },
		{ method: 'GET', path: `/shops/${exampleShopId}/customers/:externalId/points`, desc: 'Point ledger history and running balance.', key: 'either' },
		{ method: 'POST', path: `/shops/${exampleShopId}/customers/:externalId/points`, desc: 'Manually grant or deduct points (negative amount = deduct).', key: 'secret' },
		{ method: 'POST', path: `/shops/${exampleShopId}/customers/:externalId/membership`, desc: 'Enroll the customer in a paid membership plan.', key: 'secret' },
		{ method: 'GET', path: `/shops/${exampleShopId}/customers/:externalId/offers`, desc: 'Offers personalized to this customer.', key: 'either' },
		{ method: 'GET', path: `/shops/${exampleShopId}/customers/:externalId/wallet/apple`, desc: 'Signed .pkpass file for this customer.', key: 'either' },
		{ method: 'GET', path: `/shops/${exampleShopId}/customers/:externalId/wallet/google`, desc: '"Save to Google Wallet" link for this customer.', key: 'either' }
	]);

	let shopRows = $derived<Row[]>([
		{ method: 'GET', path: `/shops/${exampleShopId}/offers`, desc: 'Public, non-personalized offers — safe for a marketing page.', key: 'either' }
	]);

	function resourceRows(resource: string): Row[] {
		return [
			{ method: 'GET', path: `/${resource}`, desc: `List every ${resource.replace('-', ' ')} for your org (optional ?shopId= filter).`, key: 'either' },
			{ method: 'GET', path: `/${resource}/:id`, desc: 'Fetch one.', key: 'either' },
			{ method: 'POST', path: `/${resource}`, desc: 'Create one.', key: 'secret' },
			{ method: 'PUT', path: `/${resource}/:id`, desc: 'Replace it (send the full set of fields).', key: 'secret' },
			{ method: 'DELETE', path: `/${resource}/:id`, desc: 'Delete it.', key: 'secret' }
		];
	}

	let couponActionRows = $derived<Row[]>([
		{ method: 'POST', path: '/coupons/:code/redeem', desc: 'Redeem a coupon code at the point of sale. No shop ID needed — only your org matters.', key: 'secret' }
	]);

	const errorRows = [
		{ status: '400', meaning: 'Malformed body, or a required field is missing' },
		{ status: '401', meaning: 'Missing, malformed, or invalid/revoked API key' },
		{ status: '403', meaning: 'Wrong key type for this endpoint (needs secret), or key is scoped to a different shop' },
		{ status: '404', meaning: "Not found — including anything that exists but belongs to another organization" },
		{ status: '409', meaning: 'Conflict — duplicate externalId, or a coupon already redeemed' },
		{ status: '410', meaning: 'Coupon has expired' },
		{ status: '429', meaning: 'Rate limited — check the Retry-After header' }
	];
</script>

<PageHeader title="API Docs" subtitle="Everything a developer needs to call your rewards program's public API." />

<div style="padding:34px 40px 96px;max-width:900px;display:flex;flex-direction:column;gap:28px">
	{#if org.data}
		<div class="card" style="padding:20px 22px;display:flex;flex-direction:column;gap:12px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Your connection details</div>
			<IdLine label="Base URL" id={baseUrl} />
			<IdLine label="Organization ID" id={organizationId} />
			{#each org.data.shops as shop (shop._id)}
				<IdLine label={`Shop: ${shop.name}`} id={shop._id} />
			{/each}
			<div style="font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
				You'll also need an API key — generate one on the <a href="/orgs/{organizationId}/api-keys">API Keys</a> page.
				Try every endpoint below live, pre-filled with your own IDs, at <a href="/api-demo?shop={exampleShopId}">/api-demo</a>.
			</div>
		</div>
	{/if}

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:10px">1. Authentication</div>
		<div style="font:400 14px/1.6 'IBM Plex Sans',sans-serif;color:var(--text)">
			Every request needs an <code class="mono">Authorization: Bearer &lt;key&gt;</code> header. There are two key types:
		</div>
		<div class="card" style="margin-top:12px;padding:6px 20px 14px">
			<table>
				<thead><tr><th>Type</th><th>Prefix</th><th>Can call</th></tr></thead>
				<tbody>
					<tr>
						<td><Chip tone="rust" text="Secret" /></td>
						<td class="mono">sk_</td>
						<td>Every endpoint, including writes. Server-side only — never ship it to a browser.</td>
					</tr>
					<tr>
						<td><Chip tone="green" text="Publishable" /></td>
						<td class="mono">pk_</td>
						<td>Read-only endpoints (marked "either" below). Safe for client-side/browser code.</td>
					</tr>
				</tbody>
			</table>
		</div>
		<div style="margin-top:10px;font:400 13px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			A key can optionally be scoped to one shop when you generate it. A shop-scoped key gets <code class="mono">403</code>
			on any request for a different shop. Every response is scoped to your key's own organization — there's no way to
			reach another organization's data through this API.
		</div>
	</div>

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:10px">2. Customers</div>
		<div style="font:400 14px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted);margin-bottom:12px">
			Customers belong to one shop. Paths below are relative to <code class="mono">{baseUrl}</code>.
		</div>
		<div class="card" style="padding:6px 20px 14px">
			<table>
				<thead><tr><th>Method</th><th>Path</th><th>What it does</th><th class="right">Key</th></tr></thead>
				<tbody>
					{#each customerRows as r (r.method + r.path)}
						<tr>
							<td><Chip tone={methodTone[r.method]} mono text={r.method} /></td>
							<td class="mono" style="font-size:12.5px">{r.path}</td>
							<td style="color:var(--text-muted)">{r.desc}</td>
							<td class="right" style="color:var(--text-muted)">{r.key === 'secret' ? 'Secret' : 'Either'}</td>
						</tr>
					{/each}
					{#each shopRows as r (r.method + r.path)}
						<tr>
							<td><Chip tone={methodTone[r.method]} mono text={r.method} /></td>
							<td class="mono" style="font-size:12.5px">{r.path}</td>
							<td style="color:var(--text-muted)">{r.desc}</td>
							<td class="right" style="color:var(--text-muted)">Either</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:10px">3. Org-wide resources</div>
		<div style="font:400 14px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted);margin-bottom:12px">
			Membership plans, tiers, rewards, and coupon types aren't nested under a shop — each can optionally target one
			shop via its own <code class="mono">shopId</code> field, or apply to all shops. All four work the same way:
		</div>
		{#each [['membership-plans', 'Membership plans'], ['tiers', 'Tiers'], ['rewards', 'Rewards'], ['coupons', 'Coupon types']] as [resource, label] (resource)}
			<div style="margin-bottom:14px">
				<div style="font:500 13px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:8px">{label}</div>
				<div class="card" style="padding:6px 20px 14px">
					<table>
						<tbody>
							{#each resourceRows(resource) as r (r.method + r.path)}
								<tr>
									<td><Chip tone={methodTone[r.method]} mono text={r.method} /></td>
									<td class="mono" style="font-size:12.5px">{r.path}</td>
									<td style="color:var(--text-muted)">{r.desc}</td>
									<td class="right" style="color:var(--text-muted)">{r.key === 'secret' ? 'Secret' : 'Either'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/each}
		<div style="font:400 13px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			Example — create a membership plan:
		</div>
		<pre class="mono" style="margin-top:8px;background:var(--surface-soft);padding:12px 14px;border-radius:8px;font-size:12.5px;overflow-x:auto">curl -X POST {baseUrl}/membership-plans \
  -H "Authorization: Bearer sk_..." \
  -H "Content-Type: application/json" \
  -d '{'{'} "name": "Gold Membership", "price": 29.99, "pointMultiplier": 2 {'}'}'</pre>
		<div style="margin-top:6px;font:400 12px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			(Using your plan for reference: <code class="mono">{examplePlanId}</code> is enrolled with
			<code class="mono">POST {baseUrl}/shops/{exampleShopId}/customers/:externalId/membership</code>, body
			<code class="mono">{'{'} "planId": "{examplePlanId}" {'}'}</code>.)
		</div>
	</div>

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:10px">4. Redeeming a coupon</div>
		<div class="card" style="padding:6px 20px 14px">
			<table>
				<tbody>
					{#each couponActionRows as r (r.method + r.path)}
						<tr>
							<td><Chip tone={methodTone[r.method]} mono text={r.method} /></td>
							<td class="mono" style="font-size:12.5px">{r.path}</td>
							<td style="color:var(--text-muted)">{r.desc}</td>
							<td class="right" style="color:var(--text-muted)">Secret</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:10px">5. Idempotency</div>
		<div style="font:400 14px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			The "record event" and "enroll membership" endpoints accept an optional <code class="mono">idempotencyKey</code>
			string in the body. Retrying the identical request with the same key (e.g. after a network timeout) applies its
			effects exactly once — later calls return the current state with <code class="mono">"idempotent": true</code>
			instead of re-applying. Use your own order/transaction ID as the key.
		</div>
	</div>

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:10px">6. Errors</div>
		<div style="font:400 14px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted);margin-bottom:12px">
			Every error is <code class="mono">{'{'} "error": "&lt;message or code&gt;" {'}'}</code> with a matching HTTP status.
		</div>
		<div class="card" style="padding:6px 20px 14px">
			<table>
				<thead><tr><th>Status</th><th>Meaning</th></tr></thead>
				<tbody>
					{#each errorRows as e (e.status)}
						<tr>
							<td class="mono">{e.status}</td>
							<td style="color:var(--text-muted)">{e.meaning}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:10px">7. Rate limits</div>
		<div style="font:400 14px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			Each API key gets <strong>120 requests/minute sustained, burst up to 200</strong>. Exceeding it returns
			<code class="mono">429</code> with a <code class="mono">Retry-After</code> header (seconds until it's safe to
			retry). One key being rate-limited never affects another key, even on the same organization — back off and
			retry with <code class="mono">idempotencyKey</code> rather than looping immediately.
		</div>
	</div>
</div>
