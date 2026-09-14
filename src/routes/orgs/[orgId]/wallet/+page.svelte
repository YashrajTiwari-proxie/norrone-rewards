<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation, useAction } from 'convex-svelte';
	import QRCode from 'qrcode';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const status = useQuery(api.wallet.configStatus, () => ({ organizationId }));
	const template = useQuery(api.passTemplates.get, () => ({ organizationId }));

	const generateUploadUrl = useMutation(api.passTemplates.generateUploadUrl);
	const saveTemplate = useAction(api.passTemplates.save);

	let backgroundColor = $state('#1b2430');
	let foregroundColor = $state('#ffffff');
	let organizationDisplayName = $state('');
	let logoFile = $state<File | null>(null);
	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let saveMessage = $state<string | null>(null);
	let initialized = false;

	// Seed the form from the loaded template exactly once — after that,
	// this is user-owned draft state (mirrors staff/+page.svelte's
	// editingPlan pattern elsewhere in this app).
	$effect(() => {
		if (initialized || template.isLoading) return;
		initialized = true;
		if (template.data) {
			backgroundColor = template.data.backgroundColor ?? '#1b2430';
			foregroundColor = template.data.foregroundColor ?? '#ffffff';
			organizationDisplayName = template.data.organizationDisplayName ?? '';
		}
	});

	function onLogoSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		logoFile = input.files?.[0] ?? null;
	}

	// Live preview — reflects unsaved edits immediately, not just the last
	// saved template, so "what will this look like" is answered before you
	// commit to it. The QR encodes a placeholder id (this page isn't
	// scoped to a real customer); a real pass encodes that customer's
	// actual id — see walletNode.ts / googlePass.ts's shared barcode value.
	let logoPreviewUrl = $state<string | null>(null);
	$effect(() => {
		if (logoFile) {
			const url = URL.createObjectURL(logoFile);
			logoPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		logoPreviewUrl = template.data?.logoUrl ?? null;
	});

	let qrDataUrl = $state<string | null>(null);
	$effect(() => {
		QRCode.toDataURL('PREVIEW-CUSTOMER-ID', { width: 120, margin: 1 })
			.then((url) => (qrDataUrl = url))
			.catch(() => (qrDataUrl = null));
	});

	async function submitDesign(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		saveError = null;
		saveMessage = null;
		try {
			let logoStorageId: Id<'_storage'> | undefined;
			if (logoFile) {
				const uploadUrl = await generateUploadUrl({ organizationId });
				const res = await fetch(uploadUrl, {
					method: 'POST',
					headers: { 'Content-Type': logoFile.type },
					body: logoFile
				});
				if (!res.ok) throw new Error('Logo upload failed');
				const body = await res.json();
				logoStorageId = body.storageId as Id<'_storage'>;
			}

			const result = await saveTemplate({
				organizationId,
				logoStorageId,
				backgroundColor,
				foregroundColor,
				organizationDisplayName: organizationDisplayName.trim() || undefined
			});
			saveMessage = result.googleSynced
				? 'Saved — Apple and Google Wallet passes both updated.'
				: 'Saved for Apple Wallet. Google Wallet sync failed (check that it’s configured) — see server logs.';
			logoFile = null;
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Failed to save pass design.';
		} finally {
			saving = false;
		}
	}
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
			<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif">Apple Wallet</div>
				<div style="display:flex;gap:6px">
					<Chip tone={status.data.apple ? 'green' : 'amber'} text={status.data.apple ? 'Configured' : 'Not configured'} />
					{#if status.data.apple}
						<Chip
							tone={status.data.appleAutoUpdate ? 'green' : 'grey'}
							text={status.data.appleAutoUpdate ? 'Auto-update on' : 'Auto-update off'}
						/>
					{/if}
				</div>
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

		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:18px">
			<div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif">Pass design</div>
				<div style="margin-top:6px;font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					Applies to every customer's card on both platforms. Saving also updates your Google
					Wallet class immediately — Apple passes always regenerate fresh, so they pick this up
					on the next download automatically.
				</div>
			</div>

			{#if template.isLoading}
				<p>Loading…</p>
			{:else}
				<div>
					<div style="font:500 11px/1 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px">
						Preview
					</div>
					<div
						style="width:280px;border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:14px;background:{backgroundColor};color:{foregroundColor};box-shadow:0 8px 24px rgba(27,36,48,.16)"
					>
						<div style="display:flex;align-items:center;gap:10px">
							{#if logoPreviewUrl}
								<img src={logoPreviewUrl} alt="Logo" style="width:32px;height:32px;object-fit:contain;border-radius:6px;background:#fff" />
							{/if}
							<div style="font:600 13px/1.2 'IBM Plex Sans',sans-serif">
								{organizationDisplayName.trim() || 'Norrone Rewards'}
							</div>
						</div>
						<div>
							<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;opacity:.75;text-transform:uppercase;letter-spacing:.06em">Points</div>
							<div class="mono" style="margin-top:4px;font:600 26px/1 'IBM Plex Mono',monospace">128</div>
						</div>
						<div style="display:flex;justify-content:space-between;align-items:flex-end">
							<div>
								<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;opacity:.75;text-transform:uppercase;letter-spacing:.06em">Tier</div>
								<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Gold</div>
							</div>
							{#if qrDataUrl}
								<img src={qrDataUrl} alt="Sample barcode" style="width:56px;height:56px;border-radius:4px;background:#fff;padding:4px" />
							{/if}
						</div>
						<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;opacity:.6;text-align:center;border-top:1px solid rgba(255,255,255,.2);padding-top:10px">
							Powered by Norrone
						</div>
					</div>
					<div style="margin-top:8px;font:400 12px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
						Approximate mockup, not a pixel-exact render of Apple/Google's own UI. "128" / "Gold" are
						sample values — a real customer's pass shows their actual points/tier, and its QR code
						encodes that specific customer's id (used to look them up at the POS).
					</div>
				</div>

				<form onsubmit={submitDesign} style="display:flex;flex-direction:column;gap:16px">
					<label class="field">
						<span class="field-label">Logo (PNG recommended)</span>
						{#if template.data?.logoUrl && !logoFile}
							<img
								src={template.data.logoUrl}
								alt="Current logo"
								style="width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;background:#fff"
							/>
						{/if}
						<input type="file" accept="image/png,image/jpeg" onchange={onLogoSelected} class="input" />
						{#if logoFile}
							<span style="font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">Selected: {logoFile.name}</span>
						{/if}
					</label>
					<div style="display:flex;gap:16px">
						<label class="field" style="flex:1">
							<span class="field-label">Background color</span>
							<input type="color" bind:value={backgroundColor} class="input" style="height:38px;padding:2px" />
						</label>
						<label class="field" style="flex:1">
							<span class="field-label">Text color</span>
							<input type="color" bind:value={foregroundColor} class="input" style="height:38px;padding:2px" />
						</label>
					</div>
					<label class="field">
						<span class="field-label">Display name on pass (optional — defaults to your org name)</span>
						<input type="text" bind:value={organizationDisplayName} class="input" placeholder="Norrone Rewards" />
					</label>

					{#if saveError}
						<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{saveError}</div>
					{/if}
					{#if saveMessage}
						<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-green)">{saveMessage}</div>
					{/if}

					<button type="submit" class="btn btn-primary" style="align-self:flex-start" disabled={saving}>
						{#if saving}<span class="spinner"></span>Saving…{:else}Save pass design{/if}
					</button>
				</form>
			{/if}
		</div>

		<div style="font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			Once a platform is configured above, "Add to Wallet" buttons appear on each customer's
			detail page.
		</div>
	{/if}
</div>
