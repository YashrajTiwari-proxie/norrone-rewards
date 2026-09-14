<script lang="ts">
	import { page } from '$app/state';
	import { PUBLIC_CONVEX_SITE_URL } from '$env/static/public';

	// Example integration for the full public /v1/... API (see
	// docs/API.md) — every call here is a plain fetch() against
	// PUBLIC_CONVEX_SITE_URL using an org's own API key, exactly the way
	// that org's own website/POS would. No Better Auth session involved.
	// Same query-param pre-fill convention as /wallet-demo.

	let apiKey = $state(page.url.searchParams.get('key') ?? '');
	let shopId = $state(page.url.searchParams.get('shop') ?? '');
	let externalId = $state(page.url.searchParams.get('customer') ?? '');

	function baseUrl() {
		return `${PUBLIC_CONVEX_SITE_URL}/v1/shops/${encodeURIComponent(shopId.trim())}`;
	}

	function customerUrl(suffix = '') {
		return `${baseUrl()}/customers/${encodeURIComponent(externalId.trim())}${suffix}`;
	}

	async function call(
		method: 'GET' | 'POST' | 'PUT',
		url: string,
		body?: unknown
	): Promise<{ status: number; body: unknown }> {
		const res = await fetch(url, {
			method,
			headers: {
				Authorization: `Bearer ${apiKey.trim()}`,
				...(body ? { 'Content-Type': 'application/json' } : {})
			},
			body: body ? JSON.stringify(body) : undefined
		});
		const responseBody = await res.json().catch(() => null);
		return { status: res.status, body: responseBody };
	}

	function needs(...fields: { value: string; label: string }[]): string | null {
		for (const f of fields) if (!f.value.trim()) return `${f.label} is required.`;
		return null;
	}

	// One small reactive result-slot per action, all following the same
	// shape — keeps each section self-contained (its own busy/result/error)
	// without a generic framework for what's just seven buttons.
	function resultSlot() {
		let busy = $state(false);
		let result = $state<{ status: number; body: unknown } | null>(null);
		let error = $state<string | null>(null);
		return {
			get busy() {
				return busy;
			},
			get result() {
				return result;
			},
			get error() {
				return error;
			},
			async run(fn: () => Promise<{ status: number; body: unknown }>, validationError: string | null) {
				if (validationError) {
					error = validationError;
					result = null;
					return;
				}
				busy = true;
				error = null;
				result = null;
				try {
					result = await fn();
				} catch {
					error = 'Network error — is the API reachable?';
				} finally {
					busy = false;
				}
			}
		};
	}

	const createSlot = resultSlot();
	const fetchSlot = resultSlot();
	const eventSlot = resultSlot();
	const membershipSlot = resultSlot();
	const personalOffersSlot = resultSlot();
	const shopOffersSlot = resultSlot();
	const redeemSlot = resultSlot();

	let customerName = $state('');
	let customerPhone = $state('');
	let customerEmail = $state('');

	let deltaSpend = $state('');
	let deltaVisits = $state('');
	let action = $state('PURCHASE');
	let eventIdempotencyKey = $state('');

	let planId = $state('');
	let membershipIdempotencyKey = $state('');

	let couponCode = $state('');

	const connectionError = () =>
		needs({ value: apiKey, label: 'API key' }, { value: shopId, label: 'Shop ID' });
	const customerError = () => connectionError() ?? needs({ value: externalId, label: 'Customer external ID' });
</script>

<svelte:head>
	<title>API demo — Norrone Loyalty</title>
</svelte:head>

<div style="min-height:100vh;background:var(--paper);padding:48px 24px;font-family:'IBM Plex Sans',sans-serif;color:var(--text)">
	<div style="max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:24px">
		<div>
			<div style="font:600 22px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink)">Public API demo</div>
			<div style="margin-top:8px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
				Exercises every endpoint in <code class="mono">docs/API.md</code> directly from the browser —
				the same requests your own website/POS would send. See also
				<a href="/wallet-demo">/wallet-demo</a> for the Apple/Google Wallet endpoints specifically.
			</div>
		</div>

		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Connection</div>
			<label class="field">
				<span class="field-label">API key (secret key needed for anything but reads)</span>
				<input bind:value={apiKey} type="text" placeholder="sk_… or pk_…" class="input mono" />
			</label>
			<label class="field">
				<span class="field-label">Shop ID</span>
				<input bind:value={shopId} type="text" placeholder="md7…" class="input mono" />
			</label>
		</div>

		<!-- Create customer -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Create customer — POST /customers</div>
			<label class="field">
				<span class="field-label">External ID</span>
				<input bind:value={externalId} type="text" placeholder="e.g. cust-1042" class="input mono" />
			</label>
			<div style="display:flex;gap:10px;flex-wrap:wrap">
				<input bind:value={customerName} type="text" placeholder="Name (optional)" class="input" style="flex:1;min-width:140px" />
				<input bind:value={customerPhone} type="text" placeholder="Phone (optional)" class="input" style="flex:1;min-width:140px" />
			</div>
			<input bind:value={customerEmail} type="email" placeholder="Email (optional)" class="input" />
			<button
				type="button"
				class="btn btn-primary"
				style="align-self:flex-start"
				disabled={createSlot.busy}
				onclick={() =>
					createSlot.run(
						() =>
							call('POST', customerUrl(), {
								externalId: externalId.trim(),
								name: customerName.trim() || undefined,
								phone: customerPhone.trim() || undefined,
								email: customerEmail.trim() || undefined
							}),
						customerError()
					)}
			>
				{#if createSlot.busy}<span class="spinner"></span>Creating…{:else}Create{/if}
			</button>
			{#if createSlot.error}<div style="color:var(--stamp-rust);font-size:13px">{createSlot.error}</div>{/if}
			{#if createSlot.result}
				<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">{createSlot.result.status}
{JSON.stringify(createSlot.result.body, null, 2)}</pre>
			{/if}
		</div>

		<!-- Fetch customer -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Fetch customer — GET /customers/:externalId</div>
			<div style="font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">Uses the external ID above.</div>
			<button
				type="button"
				class="btn btn-outline"
				style="align-self:flex-start"
				disabled={fetchSlot.busy}
				onclick={() => fetchSlot.run(() => call('GET', customerUrl()), customerError())}
			>
				{#if fetchSlot.busy}<span class="spinner"></span>Fetching…{:else}Fetch{/if}
			</button>
			{#if fetchSlot.error}<div style="color:var(--stamp-rust);font-size:13px">{fetchSlot.error}</div>{/if}
			{#if fetchSlot.result}
				<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">{fetchSlot.result.status}
{JSON.stringify(fetchSlot.result.body, null, 2)}</pre>
			{/if}
		</div>

		<!-- Record event -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Record event — PUT /customers/:externalId</div>
			<div style="display:flex;gap:10px;flex-wrap:wrap">
				<input bind:value={deltaSpend} type="number" step="any" placeholder="deltaSpend" class="input mono" style="flex:1;min-width:100px" />
				<input bind:value={deltaVisits} type="number" step="1" placeholder="deltaVisits" class="input mono" style="flex:1;min-width:100px" />
			</div>
			<input bind:value={action} type="text" placeholder="action (e.g. PURCHASE)" class="input" />
			<input bind:value={eventIdempotencyKey} type="text" placeholder="idempotencyKey (optional)" class="input mono" />
			<button
				type="button"
				class="btn btn-primary"
				style="align-self:flex-start"
				disabled={eventSlot.busy}
				onclick={() =>
					eventSlot.run(
						() =>
							call('PUT', customerUrl(), {
								deltaSpend: deltaSpend.trim() ? Number(deltaSpend) : undefined,
								deltaVisits: deltaVisits.trim() ? Number(deltaVisits) : undefined,
								action: action.trim() || undefined,
								idempotencyKey: eventIdempotencyKey.trim() || undefined
							}),
						customerError()
					)}
			>
				{#if eventSlot.busy}<span class="spinner"></span>Recording…{:else}Record event{/if}
			</button>
			{#if eventSlot.error}<div style="color:var(--stamp-rust);font-size:13px">{eventSlot.error}</div>{/if}
			{#if eventSlot.result}
				<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">{eventSlot.result.status}
{JSON.stringify(eventSlot.result.body, null, 2)}</pre>
			{/if}
		</div>

		<!-- Enroll membership -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Enroll membership — POST /customers/:externalId/membership</div>
			<input bind:value={planId} type="text" placeholder="Membership plan ID (from the dashboard)" class="input mono" />
			<input bind:value={membershipIdempotencyKey} type="text" placeholder="idempotencyKey (optional)" class="input mono" />
			<button
				type="button"
				class="btn btn-primary"
				style="align-self:flex-start"
				disabled={membershipSlot.busy}
				onclick={() =>
					membershipSlot.run(
						() =>
							call('POST', customerUrl('/membership'), {
								planId: planId.trim(),
								idempotencyKey: membershipIdempotencyKey.trim() || undefined
							}),
						customerError() ?? needs({ value: planId, label: 'Plan ID' })
					)}
			>
				{#if membershipSlot.busy}<span class="spinner"></span>Enrolling…{:else}Enroll{/if}
			</button>
			{#if membershipSlot.error}<div style="color:var(--stamp-rust);font-size:13px">{membershipSlot.error}</div>{/if}
			{#if membershipSlot.result}
				<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">{membershipSlot.result.status}
{JSON.stringify(membershipSlot.result.body, null, 2)}</pre>
			{/if}
		</div>

		<!-- Offers -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Offers</div>
			<div style="display:flex;gap:10px;flex-wrap:wrap">
				<button
					type="button"
					class="btn btn-outline"
					disabled={personalOffersSlot.busy}
					onclick={() => personalOffersSlot.run(() => call('GET', customerUrl('/offers')), customerError())}
				>
					{#if personalOffersSlot.busy}<span class="spinner"></span>{:else}Personalized (this customer){/if}
				</button>
				<button
					type="button"
					class="btn btn-outline"
					disabled={shopOffersSlot.busy}
					onclick={() => shopOffersSlot.run(() => call('GET', `${baseUrl()}/offers`), connectionError())}
				>
					{#if shopOffersSlot.busy}<span class="spinner"></span>{:else}Shop-wide (public){/if}
				</button>
			</div>
			{#if personalOffersSlot.error}<div style="color:var(--stamp-rust);font-size:13px">{personalOffersSlot.error}</div>{/if}
			{#if personalOffersSlot.result}
				<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">personalized {personalOffersSlot.result.status}
{JSON.stringify(personalOffersSlot.result.body, null, 2)}</pre>
			{/if}
			{#if shopOffersSlot.error}<div style="color:var(--stamp-rust);font-size:13px">{shopOffersSlot.error}</div>{/if}
			{#if shopOffersSlot.result}
				<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">shop-wide {shopOffersSlot.result.status}
{JSON.stringify(shopOffersSlot.result.body, null, 2)}</pre>
			{/if}
		</div>

		<!-- Redeem coupon -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">Redeem coupon — POST /coupons/:code/redeem</div>
			<div style="font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">No shop ID in this one — only the API key's own organization matters.</div>
			<input bind:value={couponCode} type="text" placeholder="Coupon code (or signed code.signature)" class="input mono" />
			<button
				type="button"
				class="btn btn-primary"
				style="align-self:flex-start"
				disabled={redeemSlot.busy}
				onclick={() =>
					redeemSlot.run(
						() => call('POST', `${PUBLIC_CONVEX_SITE_URL}/v1/coupons/${encodeURIComponent(couponCode.trim())}/redeem`),
						needs({ value: apiKey, label: 'API key' }, { value: couponCode, label: 'Coupon code' })
					)}
			>
				{#if redeemSlot.busy}<span class="spinner"></span>Redeeming…{:else}Redeem{/if}
			</button>
			{#if redeemSlot.error}<div style="color:var(--stamp-rust);font-size:13px">{redeemSlot.error}</div>{/if}
			{#if redeemSlot.result}
				<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">{redeemSlot.result.status}
{JSON.stringify(redeemSlot.result.body, null, 2)}</pre>
			{/if}
		</div>

		<div style="font:400 12px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			This page only ever talks to <code class="mono">{PUBLIC_CONVEX_SITE_URL}/v1/...</code>. Pre-fill via
			<code class="mono">?key=&amp;shop=&amp;customer=</code> query params to share a ready-to-click link.
		</div>
	</div>
</div>
