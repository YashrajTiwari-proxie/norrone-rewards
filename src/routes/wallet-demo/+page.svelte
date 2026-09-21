<script lang="ts">
	import { page } from '$app/state';

	// Example integration for docs/API.md's wallet endpoints — this page
	// calls the public /v1/... API directly from the browser using an org's
	// own API key, exactly the way an org's own website/POS would. It's
	// intentionally a plain fetch() against this app's own domain (proxied
	// through to the backend — see src/routes/v1/[...path]/+server.ts), not
	// a dashboard feature — nothing here talks to Better Auth or any
	// session-authenticated Convex function.
	//
	// Optionally pre-filled via ?key=&shop=&customer= query params, so a
	// single link can hand someone a ready-to-click demo instead of three
	// values to copy-paste in by hand.

	let apiKey = $state(page.url.searchParams.get('key') ?? '');
	let shopId = $state(page.url.searchParams.get('shop') ?? '');
	let externalId = $state(page.url.searchParams.get('customer') ?? '');

	let appleBusy = $state(false);
	let googleBusy = $state(false);
	let errorMessage = $state<string | null>(null);
	let googleSaveUrl = $state<string | null>(null);

	function walletUrl(platform: 'apple' | 'google') {
		return `${page.url.origin}/v1/shops/${encodeURIComponent(shopId.trim())}/customers/${encodeURIComponent(externalId.trim())}/wallet/${platform}`;
	}

	function validateInputs(): boolean {
		if (!apiKey.trim() || !shopId.trim() || !externalId.trim()) {
			errorMessage = 'API key, shop ID, and customer external ID are all required.';
			return false;
		}
		return true;
	}

	async function downloadApplePass() {
		if (!validateInputs()) return;
		appleBusy = true;
		errorMessage = null;
		try {
			const res = await fetch(walletUrl('apple'), {
				headers: { Authorization: `Bearer ${apiKey.trim()}` }
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				errorMessage = body?.message ?? body?.error ?? `Request failed (${res.status}).`;
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'loyalty.pkpass';
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch {
			errorMessage = 'Network error — is the API reachable?';
		} finally {
			appleBusy = false;
		}
	}

	async function fetchGoogleLink() {
		if (!validateInputs()) return;
		googleBusy = true;
		errorMessage = null;
		googleSaveUrl = null;
		try {
			const res = await fetch(walletUrl('google'), {
				headers: { Authorization: `Bearer ${apiKey.trim()}` }
			});
			const body = await res.json().catch(() => null);
			if (!res.ok) {
				errorMessage = body?.message ?? body?.error ?? `Request failed (${res.status}).`;
				return;
			}
			googleSaveUrl = body.saveUrl;
		} catch {
			errorMessage = 'Network error — is the API reachable?';
		} finally {
			googleBusy = false;
		}
	}
</script>

<svelte:head>
	<title>Wallet API example — Norrone Loyalty</title>
</svelte:head>

<div style="min-height:100vh;background:var(--paper);padding:48px 24px;font-family:'IBM Plex Sans',sans-serif;color:var(--text)">
	<div style="max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:24px">
		<div>
			<div style="font:600 22px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink)">Wallet API example</div>
			<div style="margin-top:8px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
				A minimal, unauthenticated demo of the public wallet-pass endpoints documented in
				<code class="mono">docs/API.md</code>. Paste any org's own API key (secret or publishable both
				work) plus a shop ID and a customer's external ID, exactly as that org's own backend or
				website would call these endpoints directly.
			</div>
		</div>

		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:16px">
			<label class="field">
				<span class="field-label">API key</span>
				<input bind:value={apiKey} type="text" placeholder="sk_… or pk_…" class="input mono" />
			</label>
			<label class="field">
				<span class="field-label">Shop ID</span>
				<input bind:value={shopId} type="text" placeholder="md7…" class="input mono" />
			</label>
			<label class="field">
				<span class="field-label">Customer external ID</span>
				<input bind:value={externalId} type="text" placeholder="e.g. cust-1042" class="input mono" />
			</label>

			{#if errorMessage}
				<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
			{/if}

			<div style="display:flex;gap:10px;flex-wrap:wrap">
				<button type="button" class="btn btn-primary" onclick={downloadApplePass} disabled={appleBusy}>
					{#if appleBusy}<span class="spinner"></span>Fetching…{:else}Download Apple Wallet pass{/if}
				</button>
				<button type="button" class="btn btn-outline" onclick={fetchGoogleLink} disabled={googleBusy}>
					{#if googleBusy}<span class="spinner"></span>Fetching…{:else}Get Google Wallet link{/if}
				</button>
			</div>

			{#if googleSaveUrl}
				<a href={googleSaveUrl} target="_blank" rel="noopener" class="btn btn-accent" style="text-align:center;text-decoration:none">
					Add to Google Wallet →
				</a>
			{/if}
		</div>

		<div style="font:400 12px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			This page only ever talks to <code class="mono">{page.url.origin}/v1/...</code> — the same
			public API any external integration uses. It has no access to your dashboard session, and nothing
			you type here is stored anywhere. Tip: the fields above can be pre-filled via
			<code class="mono">?key=&amp;shop=&amp;customer=</code> query params, so you can share one link
			that's ready to click instead of three values to paste in.
		</div>
	</div>
</div>
