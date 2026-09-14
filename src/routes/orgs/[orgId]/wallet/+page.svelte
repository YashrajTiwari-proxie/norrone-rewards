<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { page } from '$app/state';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const status = useQuery(api.wallet.configStatus, () => ({ organizationId }));
</script>

<!--
	The pass-building pipeline (convex/wallet.ts, convex/walletNode.ts,
	convex/lib/wallet/*, convex/httpWallet.ts) is fully wired — every
	customer's "Add to Wallet" buttons (customer detail page) work the
	moment the env vars below are set. Until then both platforms 503 with
	a clear "not configured" message, which is what this page reports.
-->
<PageHeader title="Wallet Pass" subtitle="Apple and Google Wallet passes for your loyalty card." />

<div style="padding:34px 40px 72px;max-width:760px;display:flex;flex-direction:column;gap:20px">
	{#if status.isLoading}
		<p>Loading…</p>
	{:else if status.error}
		<p>Failed to load wallet status: {status.error.message}</p>
	{:else}
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:16px">
			<div style="display:flex;align-items:center;justify-content:space-between">
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif">Apple Wallet</div>
				<Chip tone={status.data.apple ? 'green' : 'amber'} text={status.data.apple ? 'Configured' : 'Not configured'} />
			</div>
			{#if !status.data.apple}
				<div style="font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					Set these via <code class="mono">npx convex env set NAME value</code>:
					<code class="mono" style="display:block;margin-top:6px">APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT_PEM, APPLE_PASS_KEY_PEM, APPLE_WWDR_CERT_PEM</code>
					(optionally <code class="mono">APPLE_PASS_KEY_PASSPHRASE</code> if your key is encrypted).
				</div>
			{/if}
		</div>

		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:16px">
			<div style="display:flex;align-items:center;justify-content:space-between">
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif">Google Wallet</div>
				<Chip tone={status.data.google ? 'green' : 'amber'} text={status.data.google ? 'Configured' : 'Not configured'} />
			</div>
			{#if !status.data.google}
				<div style="font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					Set these via <code class="mono">npx convex env set NAME value</code>:
					<code class="mono" style="display:block;margin-top:6px">GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_JSON</code>
					(optionally <code class="mono">GOOGLE_WALLET_CLASS_ID</code>).
				</div>
			{/if}
		</div>

		<div style="font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			Every pass uses a single default design for now (no per-org branding yet). Once a platform
			is configured, "Add to Wallet" buttons appear on each customer's detail page.
		</div>
	{/if}
</div>
