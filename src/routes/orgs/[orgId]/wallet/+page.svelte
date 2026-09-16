<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation, useAction } from 'convex-svelte';
	import QRCode from 'qrcode';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';
	import { contrastRatio, deriveLabelColor, MIN_CONTRAST_RATIO } from '../../../../../convex/lib/wallet/color';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const status = useQuery(api.wallet.configStatus, () => ({ organizationId }));
	const template = useQuery(api.passTemplates.get, () => ({ organizationId }));

	const generateUploadUrl = useMutation(api.passTemplates.generateUploadUrl);
	const saveTemplate = useAction(api.passTemplates.save);

	// Matches convex/wallet.ts's DEFAULT_PASS_DESIGN — the redesigned
	// palette (see docs/WALLET_PASS_REDESIGN_PLAN.md), not arbitrary
	// placeholders. labelColor has no input here — it's always derived
	// from background+foreground (deriveLabelColor), shown read-only below.
	let backgroundColor = $state('#14211F');
	let foregroundColor = $state('#F2F0E9');
	let accentColor = $state('#C9A227');
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
			backgroundColor = template.data.backgroundColor ?? '#14211F';
			foregroundColor = template.data.foregroundColor ?? '#F2F0E9';
			accentColor = template.data.accentColor ?? '#C9A227';
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

	// Same threshold + formula the server enforces on save (passTemplates.ts)
	// — surfaced here so a bad color choice is flagged before submit, not
	// just as a save-time error.
	let labelColor = $derived(deriveLabelColor(backgroundColor, foregroundColor));
	let contrast = $derived(contrastRatio(foregroundColor, backgroundColor));
	let lowContrast = $derived(contrast < MIN_CONTRAST_RATIO);

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
				accentColor,
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
						style="width:280px;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;background:{backgroundColor};color:{foregroundColor};box-shadow:0 8px 24px rgba(27,36,48,.16)"
					>
						<div style="padding:16px 18px 0;display:flex;align-items:center;justify-content:space-between;gap:10px">
							<div style="display:flex;align-items:center;gap:10px">
								{#if logoPreviewUrl}
									<img src={logoPreviewUrl} alt="Logo" style="width:28px;height:28px;object-fit:contain;border-radius:6px;background:#fff" />
								{/if}
								<div style="font:600 13px/1.2 'IBM Plex Sans',sans-serif">
									{organizationDisplayName.trim() || 'Norrone Rewards'}
								</div>
							</div>
							<div style="font:600 9px/1 'IBM Plex Sans',sans-serif;letter-spacing:.06em;opacity:.75;white-space:nowrap">
								NORRONE
							</div>
						</div>

						<!-- Variant 1b "Banded" strip — procedurally generated from
							background+accent, not uploaded artwork (see
							docs/WALLET_PASS_REDESIGN_PLAN.md). This preview approximates
							it with CSS; the real pass renders an actual generated PNG. -->
						<div style="margin-top:14px;height:60px;position:relative;background:{backgroundColor}">
							<div style="position:absolute;left:0;bottom:0;width:62%;height:34%;background:{accentColor}"></div>
						</div>

						<div style="padding:16px 18px 0">
							<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
								Points
							</div>
							<div class="mono" style="margin-top:4px;font:600 30px/1 'IBM Plex Mono',monospace">128</div>
						</div>
						<div style="padding:14px 18px 0;display:flex;gap:20px">
							<div>
								<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
									Tier
								</div>
								<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Gold</div>
							</div>
							<div>
								<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
									Membership
								</div>
								<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Omakase Club</div>
							</div>
						</div>
						<div style="padding:14px 18px 0">
							<div style="font:400 10px/1 'IBM Plex Sans',sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{labelColor}">
								Member
							</div>
							<div style="margin-top:4px;font:500 13px/1 'IBM Plex Sans',sans-serif">Sample Customer</div>
						</div>
						<div style="padding:18px;display:flex;justify-content:center">
							{#if qrDataUrl}
								<img src={qrDataUrl} alt="Sample barcode" style="width:64px;height:64px;border-radius:4px;background:#fff;padding:4px" />
							{/if}
						</div>
					</div>
					<div style="margin-top:8px;font:400 12px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
						Approximate mockup, not a pixel-exact render of Apple/Google's own UI. "128" / "Gold" /
						"Omakase Club" are sample values — a real customer's pass shows their actual points/tier/
						membership (only shown when they have one), and its barcode encodes that specific
						customer's id. The "Member" label above the name only appears when the customer has an
						active membership — otherwise it reads "Customer".
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
						<label class="field" style="flex:1">
							<span class="field-label">Accent color</span>
							<input type="color" bind:value={accentColor} class="input" style="height:38px;padding:2px" />
						</label>
					</div>
					{#if lowContrast}
						<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">
							Text color doesn't contrast enough against the background ({contrast.toFixed(1)}:1, needs
							at least {MIN_CONTRAST_RATIO}:1) — pick a lighter or darker text color, or saving will
							be rejected.
						</div>
					{/if}
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

					<button type="submit" class="btn btn-primary" style="align-self:flex-start" disabled={saving || lowContrast}>
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
