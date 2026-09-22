<script lang="ts">
	import { page } from '$app/state';

	// Example integration for the full public /v1/... API (see
	// docs/API.md) — every call here is a plain fetch() against this
	// app's own domain (proxied through to Convex by
	// src/routes/v1/[...path]/+server.ts — see that file's own comment),
	// exactly the way a real integration should call it: devs should
	// never need to know Convex is the backend. Same query-param pre-fill
	// convention as /wallet-demo.

	let apiKey = $state(page.url.searchParams.get('key') ?? '');
	let shopId = $state(page.url.searchParams.get('shop') ?? '');
	let externalId = $state(page.url.searchParams.get('customer') ?? '');

	function apiOrigin() {
		return page.url.origin;
	}

	function baseUrl() {
		return `${apiOrigin()}/v1/shops/${encodeURIComponent(shopId.trim())}`;
	}

	function customerUrl(suffix = '') {
		return `${baseUrl()}/customers/${encodeURIComponent(externalId.trim())}${suffix}`;
	}

	// Creation is POST /customers (the base collection) with externalId in
	// the JSON body — distinct from every other customer endpoint, which
	// takes externalId as a path segment.
	function createCustomerUrl() {
		return `${baseUrl()}/customers`;
	}

	async function call(
		method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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
		if (res.status === 204) return { status: res.status, body: null };
		const responseBody = await res.json().catch(() => null);
		return { status: res.status, body: responseBody };
	}

	function needs(...fields: { value: string; label: string }[]): string | null {
		for (const f of fields) if (!f.value.trim()) return `${f.label} is required.`;
		return null;
	}

	// deltaSpend/deltaVisits are bound to <input type="number"> — Svelte
	// coerces that binding to a real number once typed (unlike a text
	// input, which always stays a string), so calling .trim() on them
	// unconditionally threw "deltaSpend.trim is not a function" before
	// fetch() ever ran — surfacing as the generic "Network error" below,
	// nothing to do with actual connectivity. Same bug class as the
	// membership plan form; see that file's numberOrUndefined comment.
	function numberOrUndefined(value: string | number): number | undefined {
		if (value === '' || value === null || value === undefined) return undefined;
		const n = Number(value);
		return Number.isFinite(n) ? n : undefined;
	}

	// One small reactive result-slot per action, all following the same
	// shape — keeps each section self-contained (its own busy/result/error)
	// without a generic framework for what's just a handful of buttons.
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
				} catch (err) {
					// A thrown error here isn't always a real network
					// failure — a client-side exception building the request
					// (e.g. calling .trim() on a value a number input had
					// coerced to a number) throws before fetch() ever runs
					// and looks identical from here. Surface the real
					// message instead of guessing "Network error" for both.
					error = err instanceof Error ? err.message : 'Request failed — is the API reachable?';
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
	const pointsGetSlot = resultSlot();
	const pointsPostSlot = resultSlot();
	const profileSlot = resultSlot();
	const deleteCustomerSlot = resultSlot();

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

	let pointsAmount = $state('');
	let pointsNote = $state('');

	const connectionError = () =>
		needs({ value: apiKey, label: 'API key' }, { value: shopId, label: 'Shop ID' });
	const customerError = () => connectionError() ?? needs({ value: externalId, label: 'Customer external ID' });

	// --- Resource CRUD demo (membership plans / tiers / rewards / coupon
	// types) — all four are org-scoped at /v1/<resource>, unlike customers
	// which stay under /v1/shops/:shopId/... (see docs/API.md). Same shape
	// for all four, so one reusable block below (resourceCrud snippet)
	// covers all of them instead of repeating this four times.
	function resourceCrudState(resourcePath: string) {
		let bodyJson = $state('{\n  "name": ""\n}');
		let itemId = $state('');
		const listSlot = resultSlot();
		const createSlot = resultSlot();
		const updateSlot = resultSlot();
		const deleteSlot = resultSlot();

		function url(suffix = '') {
			return `${apiOrigin()}/v1/${resourcePath}${suffix}`;
		}
		function parsedBody(): unknown {
			try {
				return JSON.parse(bodyJson);
			} catch {
				throw new Error('Request body is not valid JSON.');
			}
		}
		return {
			get bodyJson() {
				return bodyJson;
			},
			set bodyJson(v: string) {
				bodyJson = v;
			},
			get itemId() {
				return itemId;
			},
			set itemId(v: string) {
				itemId = v;
			},
			listSlot,
			createSlot,
			updateSlot,
			deleteSlot,
			list: () => listSlot.run(() => call('GET', url()), needs({ value: apiKey, label: 'API key' })),
			create: () =>
				createSlot.run(() => call('POST', url(), parsedBody()), needs({ value: apiKey, label: 'API key' })),
			update: () =>
				updateSlot.run(
					() => call('PUT', url(`/${encodeURIComponent(itemId.trim())}`), parsedBody()),
					needs({ value: apiKey, label: 'API key' }, { value: itemId, label: 'Item ID' })
				),
			remove: () =>
				deleteSlot.run(
					() => call('DELETE', url(`/${encodeURIComponent(itemId.trim())}`)),
					needs({ value: apiKey, label: 'API key' }, { value: itemId, label: 'Item ID' })
				)
		};
	}

	const membershipPlansCrud = resourceCrudState('membership-plans');
	const tiersCrud = resourceCrudState('tiers');
	const rewardsCrud = resourceCrudState('rewards');
	const couponsCrud = resourceCrudState('coupons');
</script>

{#snippet resultBlock(slot: ReturnType<typeof resultSlot>, label: string)}
	{#if slot.error}<div style="color:var(--stamp-rust);font-size:13px">{slot.error}</div>{/if}
	{#if slot.result}
		<pre class="mono" style="background:var(--surface-soft);padding:10px;border-radius:8px;font-size:12px;overflow-x:auto">{label} {slot.result.status}
{JSON.stringify(slot.result.body, null, 2)}</pre>
	{/if}
{/snippet}

{#snippet resourceCrud(title: string, verbPath: string, crud: ReturnType<typeof resourceCrudState>)}
	<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
		<div style="font:600 14px/1 'Geist', sans-serif">{title} — /{verbPath}</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap">
			<button type="button" class="btn btn-outline" disabled={crud.listSlot.busy} onclick={crud.list}>
				{#if crud.listSlot.busy}<span class="spinner"></span>{:else}List{/if}
			</button>
		</div>
		{@render resultBlock(crud.listSlot, 'list')}

		<label class="field">
			<span class="field-label">Request body (JSON — used for Create and Update)</span>
			<textarea bind:value={crud.bodyJson} rows="4" class="input mono" style="resize:vertical"></textarea>
		</label>
		<div style="display:flex;gap:8px;flex-wrap:wrap">
			<button type="button" class="btn btn-primary" disabled={crud.createSlot.busy} onclick={crud.create}>
				{#if crud.createSlot.busy}<span class="spinner"></span>Creating…{:else}Create{/if}
			</button>
		</div>
		{@render resultBlock(crud.createSlot, 'create')}

		<label class="field">
			<span class="field-label">Item ID (for Update / Delete)</span>
			<input bind:value={crud.itemId} type="text" class="input mono" placeholder="from List above" />
		</label>
		<div style="display:flex;gap:8px;flex-wrap:wrap">
			<button type="button" class="btn btn-outline" disabled={crud.updateSlot.busy} onclick={crud.update}>
				{#if crud.updateSlot.busy}<span class="spinner"></span>Updating…{:else}Update{/if}
			</button>
			<button type="button" class="btn-danger-text" disabled={crud.deleteSlot.busy} onclick={crud.remove}>
				{#if crud.deleteSlot.busy}<span class="spinner"></span>Deleting…{:else}Delete{/if}
			</button>
		</div>
		{@render resultBlock(crud.updateSlot, 'update')}
		{@render resultBlock(crud.deleteSlot, 'delete')}
	</div>
{/snippet}

<svelte:head>
	<title>API demo — Norrone Loyalty</title>
</svelte:head>

<div style="min-height:100vh;background:var(--paper);padding:48px 24px;font-family: 'Geist', sans-serif;color:var(--text)">
	<div style="max-width:640px;margin:0 auto;display:flex;flex-direction:column;gap:24px">
		<div>
			<div style="font:600 22px/1.2 'Bodoni Moda', serif;color:var(--ink)">Public API demo</div>
			<div style="margin-top:8px;font:400 14px/1.5 'Geist', sans-serif;color:var(--text-muted)">
				Exercises every endpoint in <code class="mono">docs/API.md</code> directly from the browser —
				the same requests your own website/POS would send. See also
				<a href="/wallet-demo">/wallet-demo</a> for the Apple/Google Wallet endpoints specifically.
			</div>
		</div>

		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Connection</div>
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
			<div style="font:600 14px/1 'Geist', sans-serif">Create customer — POST /customers</div>
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
							call('POST', createCustomerUrl(), {
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
			{@render resultBlock(createSlot, 'create')}
		</div>

		<!-- Fetch customer -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Fetch customer — GET /customers/:externalId</div>
			<div style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">Uses the external ID above.</div>
			<button
				type="button"
				class="btn btn-outline"
				style="align-self:flex-start"
				disabled={fetchSlot.busy}
				onclick={() => fetchSlot.run(() => call('GET', customerUrl()), customerError())}
			>
				{#if fetchSlot.busy}<span class="spinner"></span>Fetching…{:else}Fetch{/if}
			</button>
			{@render resultBlock(fetchSlot, 'fetch')}
		</div>

		<!-- Update / delete customer -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Update / delete customer — PUT /customers/:externalId/profile, DELETE /customers/:externalId</div>
			<div style="display:flex;gap:10px;flex-wrap:wrap">
				<input bind:value={customerName} type="text" placeholder="New name (optional)" class="input" style="flex:1;min-width:140px" />
				<input bind:value={customerPhone} type="text" placeholder="New phone (optional)" class="input" style="flex:1;min-width:140px" />
			</div>
			<div style="display:flex;gap:8px;flex-wrap:wrap">
				<button
					type="button"
					class="btn btn-outline"
					disabled={profileSlot.busy}
					onclick={() =>
						profileSlot.run(
							() =>
								call('PUT', customerUrl('/profile'), {
									name: customerName.trim() || undefined,
									phone: customerPhone.trim() || undefined,
									email: customerEmail.trim() || undefined
								}),
							customerError()
						)}
				>
					{#if profileSlot.busy}<span class="spinner"></span>Updating…{:else}Update profile{/if}
				</button>
				<button
					type="button"
					class="btn-danger-text"
					disabled={deleteCustomerSlot.busy}
					onclick={() => deleteCustomerSlot.run(() => call('DELETE', customerUrl()), customerError())}
				>
					{#if deleteCustomerSlot.busy}<span class="spinner"></span>Deleting…{:else}Delete customer{/if}
				</button>
			</div>
			{@render resultBlock(profileSlot, 'update profile')}
			{@render resultBlock(deleteCustomerSlot, 'delete')}
		</div>

		<!-- Record event -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Record event — PUT /customers/:externalId</div>
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
								deltaSpend: numberOrUndefined(deltaSpend),
								deltaVisits: numberOrUndefined(deltaVisits),
								action: action.trim() || undefined,
								idempotencyKey: eventIdempotencyKey.trim() || undefined
							}),
						customerError()
					)}
			>
				{#if eventSlot.busy}<span class="spinner"></span>Recording…{:else}Record event{/if}
			</button>
			{@render resultBlock(eventSlot, 'record')}
		</div>

		<!-- Points -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Points — GET/POST /customers/:externalId/points</div>
			<div style="display:flex;gap:10px;flex-wrap:wrap">
				<input bind:value={pointsAmount} type="number" step="any" placeholder="amount (POST only)" class="input mono" style="flex:1;min-width:100px" />
				<input bind:value={pointsNote} type="text" placeholder="note (optional)" class="input" style="flex:1;min-width:140px" />
			</div>
			<div style="display:flex;gap:8px;flex-wrap:wrap">
				<button
					type="button"
					class="btn btn-outline"
					disabled={pointsGetSlot.busy}
					onclick={() => pointsGetSlot.run(() => call('GET', customerUrl('/points')), customerError())}
				>
					{#if pointsGetSlot.busy}<span class="spinner"></span>{:else}Get ledger + balance{/if}
				</button>
				<button
					type="button"
					class="btn btn-primary"
					disabled={pointsPostSlot.busy}
					onclick={() =>
						pointsPostSlot.run(
							() => call('POST', customerUrl('/points'), { amount: numberOrUndefined(pointsAmount), note: pointsNote.trim() || undefined }),
							customerError() ?? needs({ value: pointsAmount, label: 'Amount' })
						)}
				>
					{#if pointsPostSlot.busy}<span class="spinner"></span>Adjusting…{:else}Grant / adjust{/if}
				</button>
			</div>
			{@render resultBlock(pointsGetSlot, 'ledger')}
			{@render resultBlock(pointsPostSlot, 'adjust')}
		</div>

		<!-- Enroll membership -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Enroll membership — POST /customers/:externalId/membership</div>
			<input bind:value={planId} type="text" placeholder="Membership plan ID (from the dashboard, or List below)" class="input mono" />
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
			{@render resultBlock(membershipSlot, 'enroll')}
		</div>

		<!-- Offers -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Offers</div>
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
			{@render resultBlock(personalOffersSlot, 'personalized')}
			{@render resultBlock(shopOffersSlot, 'shop-wide')}
		</div>

		<!-- Redeem coupon -->
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:14px">
			<div style="font:600 14px/1 'Geist', sans-serif">Redeem coupon — POST /coupons/:code/redeem</div>
			<div style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">No shop ID in this one — only the API key's own organization matters.</div>
			<input bind:value={couponCode} type="text" placeholder="Coupon code (or signed code.signature)" class="input mono" />
			<button
				type="button"
				class="btn btn-primary"
				style="align-self:flex-start"
				disabled={redeemSlot.busy}
				onclick={() =>
					redeemSlot.run(
						() => call('POST', `${apiOrigin()}/v1/coupons/${encodeURIComponent(couponCode.trim())}/redeem`),
						needs({ value: apiKey, label: 'API key' }, { value: couponCode, label: 'Coupon code' })
					)}
			>
				{#if redeemSlot.busy}<span class="spinner"></span>Redeeming…{:else}Redeem{/if}
			</button>
			{@render resultBlock(redeemSlot, 'redeem')}
		</div>

		<div>
			<div style="font:600 15px/1 'Bodoni Moda', serif;color:var(--ink);margin:8px 0 14px">
				Org-wide resources — list / create / update / delete
			</div>
			<div style="font:400 13px/1.5 'Geist', sans-serif;color:var(--text-muted);margin-bottom:14px">
				Unlike customers, these four are org-scoped (not nested under a shop) — see docs/API.md.
				Paste a full JSON body for Create/Update (a minimal example is pre-filled); grab an ID from List to Update/Delete.
			</div>
			<div style="display:flex;flex-direction:column;gap:14px">
				{@render resourceCrud('Membership plans', 'membership-plans', membershipPlansCrud)}
				{@render resourceCrud('Tiers', 'tiers', tiersCrud)}
				{@render resourceCrud('Rewards', 'rewards', rewardsCrud)}
				{@render resourceCrud('Coupon types', 'coupons', couponsCrud)}
			</div>
		</div>

		<div style="font:400 12px/1.6 'Geist', sans-serif;color:var(--text-muted)">
			This page only ever talks to <code class="mono">{apiOrigin()}/v1/...</code> — this app's own domain,
			which transparently proxies through to the backend (see
			<code class="mono">src/routes/v1/[...path]/+server.ts</code>). Pre-fill via
			<code class="mono">?key=&amp;shop=&amp;customer=</code> query params to share a ready-to-click link.
		</div>
	</div>
</div>
