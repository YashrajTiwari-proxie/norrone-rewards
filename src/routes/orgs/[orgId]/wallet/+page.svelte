<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation, useAction } from 'convex-svelte';
	import QRCode from 'qrcode';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';
	import { deriveLabelColor } from '../../../../../convex/lib/wallet/color';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const status = useQuery(api.wallet.configStatus, () => ({ organizationId }));
	const template = useQuery(api.passTemplates.get, () => ({ organizationId }));

	const generateUploadUrl = useMutation(api.passTemplates.generateUploadUrl);
	const saveTemplate = useAction(api.passTemplates.save);

	// Matches convex/wallet.ts's DEFAULT_PASS_DESIGN. labelColor has no
	// input here — it's always derived from background+foreground
	// (deriveLabelColor), shown read-only in the preview below.
	let backgroundColor = $state('#14211F');
	let foregroundColor = $state('#F2F0E9');
	let organizationDisplayName = $state('');
	let logoFile = $state<File | null>(null);
	let bannerFile = $state<File | null>(null);
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
			backgroundColor = template.data.backgroundColor ?? '#14211F';
			foregroundColor = template.data.foregroundColor ?? '#F2F0E9';
			organizationDisplayName = template.data.organizationDisplayName ?? '';
		}
	});

	function onLogoSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		logoFile = input.files?.[0] ?? null;
	}

	function onBannerSelected(event: Event) {
		const input = event.target as HTMLInputElement;
		bannerFile = input.files?.[0] ?? null;
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

	let bannerPreviewUrl = $state<string | null>(null);
	$effect(() => {
		if (bannerFile) {
			const url = URL.createObjectURL(bannerFile);
			bannerPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		bannerPreviewUrl = template.data?.bannerUrl ?? null;
	});

	// No contrast enforcement — orgs pick their own colors and see the
	// result in the preview below; we don't second-guess their choice.
	let labelColor = $derived(deriveLabelColor(backgroundColor, foregroundColor));

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
			async function upload(file: File): Promise<Id<'_storage'>> {
				const uploadUrl = await generateUploadUrl({ organizationId });
				const res = await fetch(uploadUrl, {
					method: 'POST',
					headers: { 'Content-Type': file.type },
					body: file
				});
				if (!res.ok) throw new Error('Upload failed');
				const body = await res.json();
				return body.storageId as Id<'_storage'>;
			}

			const logoStorageId = logoFile ? await upload(logoFile) : undefined;
			const bannerStorageId = bannerFile ? await upload(bannerFile) : undefined;

			const result = await saveTemplate({
				organizationId,
				logoStorageId,
				bannerStorageId,
				backgroundColor,
				foregroundColor,
				organizationDisplayName: organizationDisplayName.trim() || undefined
			});
			saveMessage = result.googleSynced
				? 'Saved — Apple and Google Wallet passes both updated.'
				: 'Saved for Apple Wallet. Google Wallet sync failed (check that it’s configured) — see server logs.';
			logoFile = null;
			bannerFile = null;
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
						style="width:280px;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;background:{backgroundColor};color:{foregroundColor};box-shadow:0 8px 24px rgba(27,36,48,.16)"
					>
						<div style="padding:18px 18px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
							<div style="display:flex;align-items:center;gap:10px">
								{#if logoPreviewUrl}
									<img src={logoPreviewUrl} alt="Logo" style="width:28px;height:28px;object-fit:contain;border-radius:6px;background:#fff" />
								{/if}
								<div style="font:600 13px/1.2 'IBM Plex Sans',sans-serif">
									{organizationDisplayName.trim() || 'Norrone Rewards'}
								</div>
							</div>
							<div style="text-align:right">
								<div style="font:400 9px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
									Points
								</div>
								<div class="mono" style="margin-top:2px;font:600 15px/1 'IBM Plex Mono',monospace">128</div>
							</div>
						</div>

						<!-- The full-width box: the org's own uploaded banner image, or
							(when none is set) a plain flat fill of the background color
							— never generated art. -->
						{#if bannerPreviewUrl}
							<img src={bannerPreviewUrl} alt="Banner" style="width:100%;height:80px;object-fit:cover;display:block" />
						{:else}
							<div style="height:80px;background:{backgroundColor}"></div>
						{/if}

						<div style="padding:18px 18px 0">
							<div style="font:600 20px/1.1 'IBM Plex Sans',sans-serif">
								{organizationDisplayName.trim() || 'Norrone Rewards'}
							</div>
						</div>
						<div style="padding:12px 18px 0;display:flex;gap:20px">
							<div>
								<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
									Status
								</div>
								<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Customer</div>
							</div>
							<div>
								<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
									Customer since
								</div>
								<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Jan 2026</div>
							</div>
						</div>
						<div style="padding:14px 18px 0;display:flex;gap:20px">
							<div>
								<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
									Name
								</div>
								<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Sample Customer</div>
							</div>
							<div>
								<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
									Tier
								</div>
								<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Gold</div>
							</div>
						</div>
						<div style="padding:14px 18px 0;font:400 10px/1 'IBM Plex Sans',sans-serif;opacity:.7">
							Powered by Norrone
						</div>
						<div style="padding:18px;display:flex;justify-content:center">
							{#if qrDataUrl}
								<img src={qrDataUrl} alt="Sample barcode" style="width:64px;height:64px;border-radius:4px;background:#fff;padding:4px" />
							{/if}
						</div>
					</div>
					<div style="margin-top:8px;font:400 12px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
						Approximate mockup, not a pixel-exact render of Apple/Google's own UI. Sample values shown
						— a real customer's pass shows their actual points/status/tier/membership (only shown when
						they have one), and its barcode encodes that specific customer's id. "Status" reads
						"Member" once a customer has an active membership, "Customer" otherwise — same for
						"Member since" vs "Customer since".
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
					<label class="field">
						<span class="field-label">Banner image (optional — the full-width box below the header)</span>
						{#if template.data?.bannerUrl && !bannerFile}
							<img
								src={template.data.bannerUrl}
								alt="Current banner"
								style="width:100%;max-width:280px;height:64px;object-fit:cover;border:1px solid var(--line);border-radius:8px;margin-bottom:8px"
							/>
						{/if}
						<input type="file" accept="image/png,image/jpeg" onchange={onBannerSelected} class="input" />
						{#if bannerFile}
							<span style="font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">Selected: {bannerFile.name}</span>
						{:else}
							<span style="font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
								No banner uploaded — the box shows a plain fill of your background color instead.
							</span>
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
