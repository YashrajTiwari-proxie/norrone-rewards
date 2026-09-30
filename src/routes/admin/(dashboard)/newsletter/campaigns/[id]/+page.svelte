<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import PageLoading from '$lib/components/PageLoading.svelte';
	import BlockEditor from '$lib/components/BlockEditor.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useQuery, useMutation, useAction } from 'convex-svelte';
	import { api } from '../../../../../../../convex/_generated/api';
	import type { Id } from '../../../../../../../convex/_generated/dataModel';
	import { renderBlocksToHtml, type EmailBlock } from '../../../../../../../convex/lib/emailBlocks';
	import { getPlatformAuthContext } from '$lib/platformAuth';

	let campaignId = $derived(page.params.id as Id<'campaigns'>);
	const campaign = useQuery(api.newsletter.getCampaign, () => ({ campaignId }));
	const updateCampaign = useMutation(api.newsletter.updateCampaign);
	const scheduleCampaign = useMutation(api.newsletter.scheduleCampaign);
	const cancelCampaign = useMutation(api.newsletter.cancelCampaign);
	const deleteCampaign = useMutation(api.newsletter.deleteCampaign);
	const sendTestEmail = useAction(api.newsletter.sendTestEmail);
	const auth = getPlatformAuthContext();

	let subject = $state('');
	let blocks = $state<EmailBlock[]>([]);
	let loadedFor = $state<string | null>(null);

	// Load the server's copy into local editable state exactly once per
	// campaign — after that, this component owns the working copy until
	// Save, same as every other edit-drawer form in this app.
	$effect(() => {
		if (campaign.data && loadedFor !== campaign.data.id) {
			subject = campaign.data.subject;
			blocks = campaign.data.blocks;
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
			await updateCampaign({ campaignId, subject: subject.trim(), blocks });
			savedFlash = true;
			setTimeout(() => (savedFlash = false), 1500);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to save.';
		} finally {
			saving = false;
		}
	}

	let previewHtml = $derived(renderBlocksToHtml(blocks, { unsubscribeUrl: '#' }));

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
			await updateCampaign({ campaignId, subject: subject.trim(), blocks });
			await scheduleCampaign({ campaignId, scheduledAt: new Date(scheduleAtLocal).getTime() });
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
			await cancelCampaign({ campaignId });
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
			await deleteCampaign({ campaignId });
			await goto('/admin/newsletter');
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
			await sendTestEmail({ subject: subject.trim(), blocks, to: testEmail.trim() });
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

		<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start">
			<div style="display:flex;flex-direction:column;gap:10px">
				<div style="font:600 13px 'Geist', sans-serif;color:var(--ink)">Blocks</div>
				<BlockEditor bind:blocks {isDraft} />
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
