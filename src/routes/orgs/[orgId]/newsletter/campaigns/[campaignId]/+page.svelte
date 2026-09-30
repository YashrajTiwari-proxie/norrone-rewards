<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import BlockEditor from '$lib/components/BlockEditor.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useQuery, useMutation, useAction } from 'convex-svelte';
	import { api } from '../../../../../../../convex/_generated/api';
	import type { Id } from '../../../../../../../convex/_generated/dataModel';
	import { renderBlocksToHtml, type EmailBlock } from '../../../../../../../convex/lib/emailBlocks';
	import { getPlatformAuthContext } from '$lib/platformAuth';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	let campaignId = $derived(page.params.campaignId as Id<'campaigns'>);
	const campaign = useQuery(api.newsletter.getOrgCampaign, () => ({ organizationId, campaignId }));
	const updateCampaign = useMutation(api.newsletter.updateOrgCampaign);
	const scheduleCampaign = useMutation(api.newsletter.scheduleOrgCampaign);
	const cancelCampaign = useMutation(api.newsletter.cancelOrgCampaign);
	const deleteCampaign = useMutation(api.newsletter.deleteOrgCampaign);
	const sendTestEmail = useAction(api.newsletter.sendOrgTestEmail);
	const auth = getPlatformAuthContext();

	const tiersList = useQuery(api.tiers.list, () => ({ organizationId }));
	const plansList = useQuery(api.membershipPlans.list, () => ({ organizationId }));
	const rewardsList = useQuery(api.rewards.list, () => ({ organizationId }));
	const couponsList = useQuery(api.coupons.listDefinitions, () => ({ organizationId }));

	// Lookups for the live preview only — a real send resolves each
	// recipient's own coupon code server-side (see convex/newsletter.ts's
	// processBatch); the preview just needs something to show.
	let previewRewards = $derived(
		Object.fromEntries((rewardsList.data ?? []).map((r) => [r._id, { name: r.name, description: r.description }]))
	);
	let previewCoupons = $derived(
		Object.fromEntries(
			(couponsList.data ?? []).map((c) => [
				c._id,
				{ code: 'PREVIEW-CODE', discountValue: c.discountValue, discountType: c.discountType, expiresAt: Date.now() + c.validityDays * 86400000 }
			])
		)
	);

	let subject = $state('');
	let blocks = $state<EmailBlock[]>([]);
	let loadedFor = $state<string | null>(null);

	// Audience targeting — undefined/every-field-empty means "every customer
	// with an email on file" (see convex/lib/audience.ts). `selectedCustomers`
	// mirrors `customerIds` but also carries name/email for the chip UI,
	// since the id alone isn't human-readable.
	let audienceMode = $state<'all' | 'segment'>('all');
	let tierIds = $state<Id<'tiers'>[]>([]);
	let membershipPlanIds = $state<Id<'membershipPlans'>[]>([]);
	let pointsMin = $state<number | null>(null);
	let pointsMax = $state<number | null>(null);
	let selectedCustomers = $state<{ id: Id<'customers'>; name: string; email: string }[]>([]);
	let customerSearch = $state('');

	function currentAudienceFilter() {
		if (audienceMode === 'all') return {};
		return {
			tierIds,
			membershipPlanIds,
			pointsMin: pointsMin ?? undefined,
			pointsMax: pointsMax ?? undefined,
			customerIds: selectedCustomers.map((c) => c.id)
		};
	}

	let previewAudience = useQuery(api.newsletter.previewOrgAudience, () => ({
		organizationId,
		audience: currentAudienceFilter()
	}));

	const customerSearchResults = useQuery(api.newsletter.searchOrgCustomers, () => ({
		organizationId,
		search: customerSearch
	}));

	// Hydrates name/email for a just-loaded campaign's saved customerIds —
	// resolveOrgCustomers is skipped once resolvedFor catches up, so this
	// only ever runs once per campaign, not on every audience edit.
	let resolvedFor = $state<string | null>(null);
	let pendingResolveIds = $state<Id<'customers'>[]>([]);
	const resolvedCustomers = useQuery(api.newsletter.resolveOrgCustomers, () =>
		pendingResolveIds.length > 0 ? { organizationId, customerIds: pendingResolveIds } : 'skip'
	);
	$effect(() => {
		if (resolvedCustomers.data && loadedFor && resolvedFor !== loadedFor) {
			selectedCustomers = resolvedCustomers.data;
			resolvedFor = loadedFor;
		}
	});

	function toggleTier(id: Id<'tiers'>) {
		tierIds = tierIds.includes(id) ? tierIds.filter((t) => t !== id) : [...tierIds, id];
	}
	function togglePlan(id: Id<'membershipPlans'>) {
		membershipPlanIds = membershipPlanIds.includes(id)
			? membershipPlanIds.filter((p) => p !== id)
			: [...membershipPlanIds, id];
	}
	function addCustomer(c: { id: Id<'customers'>; name: string; email: string }) {
		if (!selectedCustomers.some((s) => s.id === c.id)) selectedCustomers = [...selectedCustomers, c];
		customerSearch = '';
	}
	function removeCustomer(id: Id<'customers'>) {
		selectedCustomers = selectedCustomers.filter((c) => c.id !== id);
	}

	// Load the server's copy into local editable state exactly once per
	// campaign — after that, this component owns the working copy until
	// Save, same as every other edit-drawer form in this app.
	$effect(() => {
		if (campaign.data && loadedFor !== campaign.data.id) {
			subject = campaign.data.subject;
			blocks = campaign.data.blocks;
			const a = campaign.data.audience;
			tierIds = (a?.tierIds ?? []) as Id<'tiers'>[];
			membershipPlanIds = (a?.membershipPlanIds ?? []) as Id<'membershipPlans'>[];
			pointsMin = a?.pointsMin ?? null;
			pointsMax = a?.pointsMax ?? null;
			selectedCustomers = [];
			pendingResolveIds = (a?.customerIds ?? []) as Id<'customers'>[];
			audienceMode = a?.customerIds && a.customerIds.length > 0 ? 'segment' : a && (a.tierIds?.length || a.membershipPlanIds?.length || a.pointsMin !== undefined || a.pointsMax !== undefined) ? 'segment' : 'all';
			loadedFor = campaign.data.id;
		}
	});

	let isDraft = $derived(campaign.data?.status === 'draft');
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);
	let savedFlash = $state(false);

	async function save() {
		saving = true;
		errorMessage = null;
		try {
			await updateCampaign({ organizationId, campaignId, subject: subject.trim(), blocks, audience: currentAudienceFilter() });
			savedFlash = true;
			setTimeout(() => (savedFlash = false), 1500);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to save.';
		} finally {
			saving = false;
		}
	}

	let previewHtml = $derived(
		renderBlocksToHtml(blocks, { unsubscribeUrl: '#', rewards: previewRewards, coupons: previewCoupons })
	);

	// Schedule dialog — batch size/interval aren't user-facing; the
	// campaign already carries sane defaults (50 recipients, 3s apart) from
	// creation, so scheduling just sends whatever's currently on the
	// campaign instead of asking the user to think about pacing.
	let scheduleOpen = $state(false);
	let scheduleAtLocal = $state('');
	let scheduling = $state(false);

	function openSchedule() {
		const inFiveMin = new Date(Date.now() + 5 * 60 * 1000);
		inFiveMin.setSeconds(0, 0);
		scheduleAtLocal = new Date(inFiveMin.getTime() - inFiveMin.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
		errorMessage = null;
		scheduleOpen = true;
	}

	async function submitSchedule(event: SubmitEvent) {
		event.preventDefault();
		scheduling = true;
		errorMessage = null;
		try {
			await updateCampaign({
				organizationId,
				campaignId,
				subject: subject.trim(),
				blocks,
				audience: currentAudienceFilter()
			});
			await scheduleCampaign({ organizationId, campaignId, scheduledAt: new Date(scheduleAtLocal).getTime() });
			scheduleOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to schedule.';
		} finally {
			scheduling = false;
		}
	}

	// Cancel
	let cancelOpen = $state(false);
	let canceling = $state(false);
	async function doCancel() {
		canceling = true;
		try {
			await cancelCampaign({ organizationId, campaignId });
			cancelOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to cancel.';
		} finally {
			canceling = false;
		}
	}

	// Delete
	let deleteOpen = $state(false);
	let deleting = $state(false);
	async function doDelete() {
		deleting = true;
		try {
			await deleteCampaign({ organizationId, campaignId });
			await goto(`/orgs/${organizationId}/newsletter`);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete.';
			deleting = false;
		}
	}

	// Test send
	let testOpen = $state(false);
	let testEmail = $state('');
	let testSending = $state(false);
	let testResult = $state<string | null>(null);
	function openTest() {
		testEmail = auth.session.current?.user.email ?? '';
		testResult = null;
		testOpen = true;
	}
	async function submitTest(event: SubmitEvent) {
		event.preventDefault();
		testSending = true;
		testResult = null;
		try {
			await sendTestEmail({ organizationId, subject: subject.trim(), blocks, to: testEmail.trim() });
			testResult = `Sent to ${testEmail.trim()}.`;
		} catch (err) {
			testResult = err instanceof Error ? err.message : 'Failed to send test email.';
		} finally {
			testSending = false;
		}
	}

	const statusTone: Record<string, 'grey' | 'amber' | 'green' | 'rust'> = {
		draft: 'grey',
		scheduled: 'amber',
		sending: 'amber',
		sent: 'green',
		canceled: 'rust'
	};


</script>

{#if campaign.isLoading}
	<PageLoading />
{:else if campaign.error}
	<p style="padding:34px 40px">Failed to load campaign: {campaign.error.message}</p>
{:else}
	<PageHeader title={campaign.data.subject || 'Untitled campaign'} subtitle="Edit the blocks, preview, then schedule.">
		{#snippet actions()}
			<Badge tone={statusTone[campaign.data.status] ?? 'grey'} text={campaign.data.status} />
			<button class="btn btn-outline" onclick={openTest}>Send test</button>
			{#if isDraft}
				<button class="btn btn-outline" onclick={save} disabled={saving}>
					{#if saving}<span class="spinner"></span>Saving…{:else if savedFlash}Saved{:else}Save draft{/if}
				</button>
				<button class="btn btn-primary" onclick={openSchedule}>Schedule</button>
			{:else if campaign.data.status === 'scheduled'}
				<button class="btn btn-danger" onclick={() => (cancelOpen = true)}>Cancel send</button>
			{/if}
		{/snippet}
	</PageHeader>

	<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:20px">
		{#if campaign.data.status === 'scheduled'}
			<div class="card" style="padding:14px 18px;font:400 13px 'Geist', sans-serif;color:var(--text-muted)">
				Scheduled for <strong style="color:var(--ink)">{new Date(campaign.data.scheduledAt ?? 0).toLocaleString()}</strong>.
			</div>
		{:else if campaign.data.status === 'sending' || campaign.data.status === 'sent'}
			<div class="card" style="padding:14px 18px;font:400 13px 'Geist', sans-serif;color:var(--text-muted)">
				{campaign.data.sentCount} of {campaign.data.totalRecipients} sent
				{#if campaign.data.failedCount}, {campaign.data.failedCount} failed{/if}.
			</div>
		{/if}

		<label class="field" style="max-width:520px">
			<span class="field-label">Subject</span>
			<input type="text" bind:value={subject} class="input" disabled={!isDraft} />
		</label>

		<div class="card" style="padding:18px 20px;display:flex;flex-direction:column;gap:14px;max-width:720px">
			<div style="display:flex;align-items:center;justify-content:space-between">
				<div style="font:600 13px 'Geist', sans-serif;color:var(--ink)">Audience</div>
				<div style="font:500 12px 'Geist', sans-serif;color:var(--text-muted)">
					{#if previewAudience.data}
						~{previewAudience.data.count.toLocaleString()} recipient{previewAudience.data.count === 1 ? '' : 's'}
					{/if}
				</div>
			</div>

			<div style="display:flex;gap:16px">
				<label style="display:flex;align-items:center;gap:6px;font:400 13px 'Geist', sans-serif;color:var(--ink)">
					<input type="radio" name="audienceMode" value="all" bind:group={audienceMode} disabled={!isDraft} />
					All customers with an email on file
				</label>
				<label style="display:flex;align-items:center;gap:6px;font:400 13px 'Geist', sans-serif;color:var(--ink)">
					<input type="radio" name="audienceMode" value="segment" bind:group={audienceMode} disabled={!isDraft} />
					Target a segment
				</label>
			</div>

			{#if audienceMode === 'segment'}
				<div style="display:flex;flex-direction:column;gap:14px;padding-top:4px;border-top:1px solid var(--line)">
					{#if selectedCustomers.length > 0}
						<div style="font:400 12px/1.4 'Geist', sans-serif;color:var(--text-muted)">
							Specific customers are selected below — they override the tier/plan/points filters.
						</div>
					{/if}

					<div>
						<div style="font:500 11px 'Geist', sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">
							Tier (any of)
						</div>
						<div style="display:flex;flex-wrap:wrap;gap:10px">
							{#each tiersList.data ?? [] as tier (tier._id)}
								<label style="display:flex;align-items:center;gap:6px;font:400 13px 'Geist', sans-serif;color:var(--ink)">
									<input
										type="checkbox"
										checked={tierIds.includes(tier._id)}
										disabled={!isDraft}
										onchange={() => toggleTier(tier._id)}
									/>
									{tier.name}
								</label>
							{/each}
							{#if tiersList.data && tiersList.data.length === 0}
								<span style="font:400 13px 'Geist', sans-serif;color:var(--text-muted)">No tiers set up yet.</span>
							{/if}
						</div>
					</div>

					<div>
						<div style="font:500 11px 'Geist', sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">
							Membership plan (any of)
						</div>
						<div style="display:flex;flex-wrap:wrap;gap:10px">
							{#each plansList.data ?? [] as plan (plan._id)}
								<label style="display:flex;align-items:center;gap:6px;font:400 13px 'Geist', sans-serif;color:var(--ink)">
									<input
										type="checkbox"
										checked={membershipPlanIds.includes(plan._id)}
										disabled={!isDraft}
										onchange={() => togglePlan(plan._id)}
									/>
									{plan.name}
								</label>
							{/each}
							{#if plansList.data && plansList.data.length === 0}
								<span style="font:400 13px 'Geist', sans-serif;color:var(--text-muted)">No membership plans set up yet.</span>
							{/if}
						</div>
					</div>

					<div style="display:flex;gap:14px">
						<label class="field" style="flex:1">
							<span class="field-label">Points ≥</span>
							<input type="number" bind:value={pointsMin} disabled={!isDraft} class="input" placeholder="No minimum" />
						</label>
						<label class="field" style="flex:1">
							<span class="field-label">Points ≤</span>
							<input type="number" bind:value={pointsMax} disabled={!isDraft} class="input" placeholder="No maximum" />
						</label>
					</div>

					<div>
						<div style="font:500 11px 'Geist', sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px">
							Or specific customers
						</div>
						{#if selectedCustomers.length > 0}
							<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
								{#each selectedCustomers as c (c.id)}
									<span style="display:flex;align-items:center;gap:6px;background:var(--paper-2, #f4f1ec);border-radius:999px;padding:4px 6px 4px 10px;font:400 12px 'Geist', sans-serif;color:var(--ink)">
										{c.name} <span style="color:var(--text-muted)">({c.email})</span>
										{#if isDraft}
											<button
												type="button"
												onclick={() => removeCustomer(c.id)}
												style="background:transparent;border:0;color:var(--text-muted);cursor:pointer;padding:2px;line-height:1"
											>
												<Icon name="close" size={11} />
											</button>
										{/if}
									</span>
								{/each}
							</div>
						{/if}
						{#if isDraft}
							<input
								type="text"
								bind:value={customerSearch}
								class="input"
								placeholder="Search customers by name or email…"
							/>
							{#if customerSearch.trim() && customerSearchResults.data}
								<div class="card" style="margin-top:6px;max-height:180px;overflow:auto">
									{#each customerSearchResults.data as c (c.id)}
										<button
											type="button"
											onclick={() => addCustomer(c)}
											style="display:block;width:100%;text-align:left;padding:8px 12px;background:transparent;border:0;border-bottom:1px solid var(--line-2);cursor:pointer;font:400 13px 'Geist', sans-serif;color:var(--ink)"
										>
											{c.name} <span style="color:var(--text-muted)">{c.email}</span>
										</button>
									{:else}
										<div style="padding:8px 12px;font:400 13px 'Geist', sans-serif;color:var(--text-muted)">No matches.</div>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
			<div style="display:flex;flex-direction:column;gap:10px">
				<div style="font:600 13px 'Geist', sans-serif;color:var(--ink)">Blocks</div>
				<BlockEditor bind:blocks {isDraft} rewards={rewardsList.data} coupons={couponsList.data} />
			</div>

			<div style="position:sticky;top:20px">
				<div style="font:600 13px 'Geist', sans-serif;color:var(--ink);margin-bottom:10px">Preview</div>
				<div class="card" style="padding:0;overflow:hidden">
					<!-- Keyed on loadedFor: an iframe whose srcdoc is written twice in
					     the same tick (empty on first render, then the real content once
					     campaign.data's $effect runs) can lose the second write in Chrome
					     — {#key} forces a fresh iframe mount once loadedFor is set, so
					     srcdoc is only ever written once per instance. -->
					{#key loadedFor}
						<iframe title="Email preview" srcdoc={previewHtml} style="width:100%;height:600px;border:0"></iframe>
					{/key}
				</div>
			</div>
		</div>

		{#if errorMessage}
			<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}

		{#if campaign.data.status !== 'sending'}
			<div style="border-top:1px solid var(--line);padding-top:16px;margin-top:4px">
				<button type="button" class="btn-danger-text" onclick={() => (deleteOpen = true)}>Delete this campaign</button>
			</div>
		{/if}
	</div>

	<Dialog bind:open={scheduleOpen} title="Schedule this campaign" note="Sends in paced batches automatically — no setup needed.">
		<form id="schedule-form" onsubmit={submitSchedule}>
			<label class="field">
				<span class="field-label">Send at</span>
				<input type="datetime-local" bind:value={scheduleAtLocal} required class="input" />
			</label>
		</form>
		{#if errorMessage}
			<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (scheduleOpen = false)} disabled={scheduling}>Cancel</button>
			<button type="submit" form="schedule-form" class="btn btn-accent" disabled={scheduling}>
				{#if scheduling}<span class="spinner"></span>Scheduling…{:else}Schedule{/if}
			</button>
		{/snippet}
	</Dialog>

	<AlertDialog
		bind:open={cancelOpen}
		title="Cancel this scheduled send?"
		body="The campaign goes back to a draft you can edit and reschedule later."
		confirmLabel="Cancel send"
		confirming={canceling}
		onconfirm={doCancel}
	/>

	<AlertDialog
		bind:open={deleteOpen}
		title="Delete this campaign?"
		body="This can't be undone. Any recipient records for this campaign are removed too."
		confirmLabel="Delete"
		confirming={deleting}
		onconfirm={doDelete}
	/>

	<Dialog bind:open={testOpen} title="Send a test email" note="Sends the current draft to one address — not counted as a real send.">
		<form id="test-form" onsubmit={submitTest}>
			<label class="field">
				<span class="field-label">Send to</span>
				<input type="email" bind:value={testEmail} required class="input" />
			</label>
		</form>
		{#if testResult}
			<div style="font:400 13px 'Geist', sans-serif;color:var(--text-muted)">{testResult}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (testOpen = false)}>Close</button>
			<button type="submit" form="test-form" class="btn btn-accent" disabled={testSending}>
				{#if testSending}<span class="spinner"></span>Sending…{:else}Send test{/if}
			</button>
		{/snippet}
	</Dialog>
{/if}
