<script lang="ts">
	import PageLoading from '$lib/components/PageLoading.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Badge from '$lib/components/Badge.svelte';
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
	const saveApple = useMutation(api.passTemplates.saveApple);
	const saveGoogle = useAction(api.passTemplates.saveGoogle);

	// Apple and Google are fully independent designs — own logo, banner,
	// colors, display name, no fallback between them — switched via tabs
	// rather than one shared form, since their real card structures differ
	// enough that a shared config kept being the wrong fit for one of them.
	let activeTab = $state<'apple' | 'google'>('apple');

	let appleBackgroundColor = $state('#14211F');
	let appleForegroundColor = $state('#F2F0E9');
	let appleDisplayName = $state('');
	let appleLogoFile = $state<File | null>(null);
	let appleBannerFile = $state<File | null>(null);
	let appleSaving = $state(false);
	let appleSaveError = $state<string | null>(null);
	let appleSaveMessage = $state<string | null>(null);

	let googleBackgroundColor = $state('#14211F');
	let googleForegroundColor = $state('#F2F0E9');
	let googleDisplayName = $state('');
	let googleLogoFile = $state<File | null>(null);
	let googleBannerFile = $state<File | null>(null);
	let googleSaving = $state(false);
	let googleSaveError = $state<string | null>(null);
	let googleSaveMessage = $state<string | null>(null);

	let initialized = false;

	// Seed both tabs' forms from the loaded template exactly once — after
	// that, this is user-owned draft state (mirrors staff/+page.svelte's
	// editingPlan pattern elsewhere in this app).
	$effect(() => {
		if (initialized || template.isLoading) return;
		initialized = true;
		if (template.data) {
			appleBackgroundColor = template.data.apple.backgroundColor ?? '#14211F';
			appleForegroundColor = template.data.apple.foregroundColor ?? '#F2F0E9';
			appleDisplayName = template.data.apple.organizationDisplayName ?? '';
			googleBackgroundColor = template.data.google.backgroundColor ?? '#14211F';
			googleForegroundColor = template.data.google.foregroundColor ?? '#F2F0E9';
			googleDisplayName = template.data.google.organizationDisplayName ?? '';
		}
	});

	function fileHandler(setter: (file: File | null) => void) {
		return (event: Event) => setter((event.target as HTMLInputElement).files?.[0] ?? null);
	}
	const onAppleLogoSelected = fileHandler((f) => (appleLogoFile = f));
	const onAppleBannerSelected = fileHandler((f) => (appleBannerFile = f));
	const onGoogleLogoSelected = fileHandler((f) => (googleLogoFile = f));
	const onGoogleBannerSelected = fileHandler((f) => (googleBannerFile = f));

	// Live previews — reflect unsaved edits immediately, not just the last
	// saved template. The barcode preview encodes a placeholder id (this
	// page isn't scoped to a real customer); a real pass encodes that
	// customer's actual id — see walletNode.ts / googlePass.ts.
	let appleLogoPreviewUrl = $state<string | null>(null);
	$effect(() => {
		if (appleLogoFile) {
			const url = URL.createObjectURL(appleLogoFile);
			appleLogoPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		appleLogoPreviewUrl = template.data?.apple.logoUrl ?? null;
	});

	let appleBannerPreviewUrl = $state<string | null>(null);
	$effect(() => {
		if (appleBannerFile) {
			const url = URL.createObjectURL(appleBannerFile);
			appleBannerPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		appleBannerPreviewUrl = template.data?.apple.bannerUrl ?? null;
	});

	let googleLogoPreviewUrl = $state<string | null>(null);
	$effect(() => {
		if (googleLogoFile) {
			const url = URL.createObjectURL(googleLogoFile);
			googleLogoPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		googleLogoPreviewUrl = template.data?.google.logoUrl ?? null;
	});

	let googleBannerPreviewUrl = $state<string | null>(null);
	$effect(() => {
		if (googleBannerFile) {
			const url = URL.createObjectURL(googleBannerFile);
			googleBannerPreviewUrl = url;
			return () => URL.revokeObjectURL(url);
		}
		googleBannerPreviewUrl = template.data?.google.bannerUrl ?? null;
	});

	// No contrast enforcement — orgs pick their own colors and see the
	// result in the preview below; we don't second-guess their choice.
	let appleLabelColor = $derived(deriveLabelColor(appleBackgroundColor, appleForegroundColor));

	let qrDataUrl = $state<string | null>(null);
	$effect(() => {
		QRCode.toDataURL('PREVIEW-CUSTOMER-ID', { width: 120, margin: 1 })
			.then((url) => (qrDataUrl = url))
			.catch(() => (qrDataUrl = null));
	});

	async function upload(file: File): Promise<Id<'_storage'>> {
		const uploadUrl = await generateUploadUrl({ organizationId });
		const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
		if (!res.ok) throw new Error('Upload failed');
		const body = await res.json();
		return body.storageId as Id<'_storage'>;
	}

	async function submitApple(event: SubmitEvent) {
		event.preventDefault();
		appleSaving = true;
		appleSaveError = null;
		appleSaveMessage = null;
		try {
			const logoStorageId = appleLogoFile ? await upload(appleLogoFile) : undefined;
			const bannerStorageId = appleBannerFile ? await upload(appleBannerFile) : undefined;
			await saveApple({
				organizationId,
				logoStorageId,
				bannerStorageId,
				backgroundColor: appleBackgroundColor,
				foregroundColor: appleForegroundColor,
				organizationDisplayName: appleDisplayName.trim() || undefined
			});
			appleSaveMessage = 'Saved — Apple Wallet passes pick this up on the next download automatically.';
			appleLogoFile = null;
			appleBannerFile = null;
		} catch (err) {
			appleSaveError = err instanceof Error ? err.message : 'Failed to save Apple Wallet design.';
		} finally {
			appleSaving = false;
		}
	}

	async function submitGoogle(event: SubmitEvent) {
		event.preventDefault();
		googleSaving = true;
		googleSaveError = null;
		googleSaveMessage = null;
		try {
			const logoStorageId = googleLogoFile ? await upload(googleLogoFile) : undefined;
			const bannerStorageId = googleBannerFile ? await upload(googleBannerFile) : undefined;
			await saveGoogle({
				organizationId,
				logoStorageId,
				bannerStorageId,
				backgroundColor: googleBackgroundColor,
				foregroundColor: googleForegroundColor,
				organizationDisplayName: googleDisplayName.trim() || undefined
			});
			googleSaveMessage = 'Saved — your Google Wallet class was updated.';
			googleLogoFile = null;
			googleBannerFile = null;
		} catch (err) {
			googleSaveError = err instanceof Error ? err.message : 'Failed to save Google Wallet design.';
		} finally {
			googleSaving = false;
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
		<PageLoading />
	{:else if status.error}
		<p>Failed to load wallet status: {status.error.message}</p>
	{:else}
		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:16px">
			<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
				<div style="font:600 15px/1 'Bodoni Moda', serif">Apple Wallet</div>
				<div style="display:flex;gap:6px">
					<Badge tone={status.data.apple ? 'green' : 'amber'} text={status.data.apple ? 'Configured' : 'Not configured'} />
					{#if status.data.apple}
						<Badge
							tone={status.data.appleAutoUpdate ? 'green' : 'grey'}
							text={status.data.appleAutoUpdate ? 'Auto-update on' : 'Auto-update off'}
						/>
					{/if}
				</div>
			</div>
			{#if !status.data.apple}
				<div style="font:400 13px/1.5 'Geist', sans-serif;color:var(--text-muted)">
					Set these via <code class="mono">npx convex env set NAME value</code>:
					<code class="mono" style="display:block;margin-top:6px">APPLE_PASS_TYPE_ID, APPLE_TEAM_ID, APPLE_PASS_CERT_PEM, APPLE_PASS_KEY_PEM, APPLE_WWDR_CERT_PEM</code>
					(optionally <code class="mono">APPLE_PASS_KEY_PASSPHRASE</code> if your key is encrypted).
				</div>
			{/if}
		</div>

		<div class="card" style="padding:22px 24px;display:flex;flex-direction:column;gap:16px">
			<div style="display:flex;align-items:center;justify-content:space-between">
				<div style="font:600 15px/1 'Bodoni Moda', serif">Google Wallet</div>
				<Badge tone={status.data.google ? 'green' : 'amber'} text={status.data.google ? 'Configured' : 'Not configured'} />
			</div>
			{#if !status.data.google}
				<div style="font:400 13px/1.5 'Geist', sans-serif;color:var(--text-muted)">
					Set these via <code class="mono">npx convex env set NAME value</code>:
					<code class="mono" style="display:block;margin-top:6px">GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_JSON</code>
					(optionally <code class="mono">GOOGLE_WALLET_CLASS_ID</code>).
				</div>
			{/if}
		</div>

		<div class="card" style="padding:0;display:flex;flex-direction:column;overflow:hidden">
			<div style="display:flex;border-bottom:1px solid var(--line)">
				<button
					type="button"
					onclick={() => (activeTab = 'apple')}
					style="flex:1;padding:16px 20px;border:none;background:{activeTab === 'apple' ? 'var(--surface)' : 'transparent'};font:600 14px 'Geist', sans-serif;cursor:pointer;border-bottom:2px solid {activeTab === 'apple' ? 'var(--ink)' : 'transparent'}"
				>
					Apple Wallet design
				</button>
				<button
					type="button"
					onclick={() => (activeTab = 'google')}
					style="flex:1;padding:16px 20px;border:none;background:{activeTab === 'google' ? 'var(--surface)' : 'transparent'};font:600 14px 'Geist', sans-serif;cursor:pointer;border-bottom:2px solid {activeTab === 'google' ? 'var(--ink)' : 'transparent'}"
				>
					Google Wallet design
				</button>
			</div>

			<div style="padding:22px 24px;display:flex;flex-direction:column;gap:18px">
				{#if template.isLoading}
					<PageLoading />
				{:else if activeTab === 'apple'}
					<div style="font:400 13px/1.5 'Geist', sans-serif;color:var(--text-muted)">
						Apple's own logo, banner, colors, and display name — fully independent of Google's tab.
						Apple passes always regenerate fresh, so a save shows up on the next download
						automatically.
					</div>

					<div>
						<div style="font:500 11px/1 'Geist', sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px">
							Preview
						</div>
						<div
							style="width:260px;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;background:{appleBackgroundColor};color:{appleForegroundColor};box-shadow:0 8px 24px rgba(22,22,22,.16)"
						>
							<div style="padding:16px 16px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px">
								<div style="display:flex;align-items:center;gap:8px;min-width:0">
									{#if appleLogoPreviewUrl}
										<img src={appleLogoPreviewUrl} alt="Logo" style="width:26px;height:26px;object-fit:contain;border-radius:6px;background:#fff;flex:none" />
									{/if}
								</div>
								<div style="text-align:right;flex:none">
									<div style="font:400 8px/1 'Geist', sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{appleLabelColor}">
										Points
									</div>
									<div class="mono" style="margin-top:2px;font:600 14px/1 'Geist Mono', monospace">128</div>
								</div>
							</div>

							{#if appleBannerPreviewUrl}
								<img src={appleBannerPreviewUrl} alt="Banner" style="width:100%;height:72px;object-fit:cover;display:block" />
							{:else}
								<div style="height:72px;background:{appleBackgroundColor}"></div>
							{/if}

							<div style="padding:14px 16px 0;display:flex;gap:18px">
								<div>
									<div style="font:400 9px/1 'Geist', sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{appleLabelColor}">
										Name
									</div>
									<div style="margin-top:4px;font:500 12px/1 'Geist', sans-serif">Sample Customer</div>
								</div>
								<div>
									<div style="font:400 9px/1 'Geist', sans-serif;text-transform:uppercase;letter-spacing:.06em;color:{appleLabelColor}">
										Status
									</div>
									<div style="margin-top:4px;font:500 12px/1 'Geist', sans-serif">Customer</div>
								</div>
							</div>
							<div style="padding:16px;display:flex;justify-content:center">
								{#if qrDataUrl}
									<img src={qrDataUrl} alt="Sample barcode" style="width:56px;height:56px;border-radius:4px;background:#fff;padding:4px" />
								{/if}
							</div>
						</div>
						<div style="margin-top:8px;font:400 12px/1.5 'Geist', sans-serif;color:var(--text-muted)">
							Approximate mockup, not pixel-exact. "128" / "Customer" are sample values — a real
							customer's pass shows their actual points/status.
						</div>
					</div>

					<form onsubmit={submitApple} style="display:flex;flex-direction:column;gap:16px">
						<label class="field">
							<span class="field-label">Logo (PNG recommended)</span>
							{#if template.data?.apple.logoUrl && !appleLogoFile}
								<img
									src={template.data.apple.logoUrl}
									alt="Current logo"
									style="width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;background:#fff"
								/>
							{/if}
							<input type="file" accept="image/png,image/jpeg" onchange={onAppleLogoSelected} class="input" />
							{#if appleLogoFile}
								<span style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">Selected: {appleLogoFile.name}</span>
							{/if}
						</label>
						<label class="field">
							<span class="field-label">Banner image (optional — the full-width box below the header)</span>
							{#if template.data?.apple.bannerUrl && !appleBannerFile}
								<img
									src={template.data.apple.bannerUrl}
									alt="Current banner"
									style="width:100%;max-width:260px;height:64px;object-fit:cover;border:1px solid var(--line);border-radius:8px;margin-bottom:8px"
								/>
							{/if}
							<input type="file" accept="image/png,image/jpeg" onchange={onAppleBannerSelected} class="input" />
							{#if appleBannerFile}
								<span style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">Selected: {appleBannerFile.name}</span>
							{:else}
								<span style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">
									No banner uploaded — the box shows a plain fill of your background color instead.
								</span>
							{/if}
						</label>
						<div style="display:flex;gap:16px">
							<label class="field" style="flex:1">
								<span class="field-label">Background color</span>
								<input type="color" bind:value={appleBackgroundColor} class="input" style="height:38px;padding:2px" />
							</label>
							<label class="field" style="flex:1">
								<span class="field-label">Text color</span>
								<input type="color" bind:value={appleForegroundColor} class="input" style="height:38px;padding:2px" />
							</label>
						</div>
						<label class="field">
							<span class="field-label">Display name on pass (optional — defaults to your org name)</span>
							<input type="text" bind:value={appleDisplayName} class="input" placeholder="Norrone Rewards" />
						</label>

						{#if appleSaveError}
							<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{appleSaveError}</div>
						{/if}
						{#if appleSaveMessage}
							<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-green)">{appleSaveMessage}</div>
						{/if}

						<button type="submit" class="btn btn-primary" style="align-self:flex-start" disabled={appleSaving}>
							{#if appleSaving}<span class="spinner"></span>Saving…{:else}Save Apple Wallet design{/if}
						</button>
					</form>
				{:else}
					<div style="font:400 13px/1.5 'Geist', sans-serif;color:var(--text-muted)">
						Google's own logo, banner, colors, and display name — fully independent of Apple's tab.
						Saving re-syncs your Google Wallet class immediately.
					</div>

					<div>
						<div style="font:500 11px/1 'Geist', sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px">
							Preview
						</div>
						<!-- Everything but logo/hero/color is Google's own fixed
							template — tier/status/membership sit behind a "Details"
							tap, never on the front. -->
						<div style="width:260px;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 8px 24px rgba(22,22,22,.16)">
							{#if googleBannerPreviewUrl}
								<img src={googleBannerPreviewUrl} alt="Hero" style="width:100%;height:80px;object-fit:cover;display:block" />
							{:else}
								<div style="height:80px;background:{googleBackgroundColor}"></div>
							{/if}
							<div style="background:{googleBackgroundColor};color:{googleForegroundColor};padding:12px 16px 16px;display:flex;flex-direction:column;gap:12px">
								<div style="display:flex;align-items:center;gap:10px">
									{#if googleLogoPreviewUrl}
										<img src={googleLogoPreviewUrl} alt="Logo" style="width:36px;height:36px;object-fit:contain;border-radius:50%;background:#fff;flex:none" />
									{/if}
									<div style="min-width:0">
										<div style="font:600 12px/1.2 'Geist', sans-serif;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
											{googleDisplayName.trim() || 'Norrone Rewards'}
										</div>
										<div style="font:400 10px/1 'Geist', sans-serif;opacity:.75;margin-top:2px">
											{googleDisplayName.trim() || 'Norrone Rewards'} Rewards
										</div>
									</div>
								</div>
								<div style="display:flex;gap:24px">
									<div>
										<div style="font:400 9px/1 'Geist', sans-serif;text-transform:uppercase;letter-spacing:.06em;opacity:.75">
											Points
										</div>
										<div class="mono" style="margin-top:4px;font:600 22px/1 'Geist Mono', monospace">128</div>
									</div>
									<div>
										<div style="font:400 9px/1 'Geist', sans-serif;text-transform:uppercase;letter-spacing:.06em;opacity:.75">
											Status
										</div>
										<div class="mono" style="margin-top:4px;font:600 22px/1 'Geist Mono', monospace">Customer</div>
									</div>
								</div>
								<div style="font:500 12px/1 'Geist', sans-serif">Sample Customer</div>
							</div>
							<div style="background:#fff;padding:14px 16px;display:flex;justify-content:center">
								{#if qrDataUrl}
									<img src={qrDataUrl} alt="Sample barcode" style="width:56px;height:56px;border-radius:4px;background:#fff;padding:4px" />
								{/if}
							</div>
							<div style="border-top:1px solid rgba(0,0,0,.08);padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
								<span style="font:500 11px 'Geist', sans-serif;color:#46514b">Details</span>
								<span style="font:400 10px 'Geist Mono', monospace;color:#6f7a74">Since · Tier ▾</span>
							</div>
						</div>
						<div style="margin-top:8px;font:400 12px/1.5 'Geist', sans-serif;color:var(--text-muted)">
							Approximate mockup, not pixel-exact. Google requires both a small title line and a
							larger one below it (verified against the live API — neither can be left empty), so
							the larger line reads "{'{shop} Rewards'}" rather than repeating the shop name twice.
						</div>
					</div>

					<form onsubmit={submitGoogle} style="display:flex;flex-direction:column;gap:16px">
						<label class="field">
							<span class="field-label">Logo (PNG recommended, square — Google masks it into a circle)</span>
							{#if template.data?.google.logoUrl && !googleLogoFile}
								<img
									src={template.data.google.logoUrl}
									alt="Current Google logo"
									style="width:64px;height:64px;object-fit:contain;border:1px solid var(--line);border-radius:50%;margin-bottom:8px;background:#fff"
								/>
							{/if}
							<input type="file" accept="image/png,image/jpeg" onchange={onGoogleLogoSelected} class="input" />
							{#if googleLogoFile}
								<span style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">Selected: {googleLogoFile.name}</span>
							{:else}
								<span style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">
									Required by Google to create the class — falls back to a generic Norrone mark if
									never set.
								</span>
							{/if}
						</label>
						<label class="field">
							<span class="field-label">Banner (hero image, optional — Google's wide banner across the top)</span>
							{#if template.data?.google.bannerUrl && !googleBannerFile}
								<img
									src={template.data.google.bannerUrl}
									alt="Current Google banner"
									style="width:100%;max-width:260px;height:64px;object-fit:cover;border:1px solid var(--line);border-radius:8px;margin-bottom:8px"
								/>
							{/if}
							<input type="file" accept="image/png,image/jpeg" onchange={onGoogleBannerSelected} class="input" />
							{#if googleBannerFile}
								<span style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">Selected: {googleBannerFile.name}</span>
							{:else}
								<span style="font:400 12px 'Geist', sans-serif;color:var(--text-muted)">
									No banner uploaded — Google shows a plain fill of your background color instead.
								</span>
							{/if}
						</label>
						<div style="display:flex;gap:16px">
							<label class="field" style="flex:1">
								<span class="field-label">Background color</span>
								<input type="color" bind:value={googleBackgroundColor} class="input" style="height:38px;padding:2px" />
							</label>
							<label class="field" style="flex:1">
								<span class="field-label">Text color (preview only — Google has no text-color field)</span>
								<input type="color" bind:value={googleForegroundColor} class="input" style="height:38px;padding:2px" />
							</label>
						</div>
						<label class="field">
							<span class="field-label">Display name on pass (optional — defaults to your org name)</span>
							<input type="text" bind:value={googleDisplayName} class="input" placeholder="Norrone Rewards" />
						</label>

						{#if googleSaveError}
							<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{googleSaveError}</div>
						{/if}
						{#if googleSaveMessage}
							<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-green)">{googleSaveMessage}</div>
						{/if}

						<button type="submit" class="btn btn-primary" style="align-self:flex-start" disabled={googleSaving}>
							{#if googleSaving}<span class="spinner"></span>Saving…{:else}Save Google Wallet design{/if}
						</button>
					</form>
				{/if}
			</div>
		</div>

		<div style="font:400 13px/1.5 'Geist', sans-serif;color:var(--text-muted)">
			Once a platform is configured above, "Add to Wallet" buttons appear on each customer's
			detail page.
		</div>
	{/if}
</div>
