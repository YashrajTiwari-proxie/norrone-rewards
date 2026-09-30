<script lang="ts">
	import Table from '$lib/components/Table.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Dialog from '$lib/components/Dialog.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import StatTicket from '$lib/components/StatTicket.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { useQuery, useMutation } from 'convex-svelte';
	import { goto } from '$app/navigation';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	const stats = useQuery(api.newsletter.subscriberStats, {});
	const campaigns = useQuery(api.newsletter.listCampaigns, {});
	const subscribers = useQuery(api.newsletter.listSubscribers, () => ({ limit: 8 }));
	const createCampaign = useMutation(api.newsletter.createCampaign);
	const deleteCampaign = useMutation(api.newsletter.deleteCampaign);

	let deleteTarget = $state<Id<'campaigns'> | null>(null);
	let deleteOpen = $state(false);
	let deleting = $state(false);
	function openDelete(campaignId: Id<'campaigns'>) {
		deleteTarget = campaignId;
		deleteOpen = true;
	}
	async function doDelete() {
		if (!deleteTarget) return;
		deleting = true;
		try {
			await deleteCampaign({ campaignId: deleteTarget });
			deleteOpen = false;
			deleteTarget = null;
		} catch {
			// AlertDialog stays open on failure — nothing else to do here, the
			// campaign row itself will still be visible so the user can retry.
		} finally {
			deleting = false;
		}
	}

	let addOpen = $state(false);
	let subject = $state('');
	let kind = $state<'newsletter' | 'promotion'>('newsletter');
	let creating = $state(false);
	let errorMessage = $state<string | null>(null);

	function openAdd() {
		subject = '';
		kind = 'newsletter';
		errorMessage = null;
		addOpen = true;
	}

	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		creating = true;
		errorMessage = null;
		try {
			const { campaignId } = await createCampaign({ subject: subject.trim(), kind });
			addOpen = false;
			await goto(`/admin/newsletter/campaigns/${campaignId}`);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create campaign.';
		} finally {
			creating = false;
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

<PageHeader title="Newsletter" subtitle="Norrone's own marketing list — subscribers, templates, and campaigns.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>New campaign</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:26px">
	{#if stats.data}
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px">
			<StatTicket label="Subscribed" value={stats.data.subscribed.toLocaleString()} icon="users" />
			<StatTicket label="Unsubscribed" value={stats.data.unsubscribed.toLocaleString()} />
			<StatTicket label="Bounced" value={stats.data.bounced.toLocaleString()} />
			<StatTicket label="Total" value={stats.data.total.toLocaleString()} />
		</div>
	{/if}

	<div>
		<div style="font:600 15px 'Bodoni Moda', serif;color:var(--ink);margin-bottom:10px">Campaigns</div>
		{#if campaigns.isLoading}
			<PageLoading />
		{:else if campaigns.error}
			<p>Failed to load campaigns: {campaigns.error.message}</p>
		{:else if campaigns.data.length === 0}
			<EmptyState title="No campaigns yet" body="Create your first campaign — pick a subject, edit the blocks, then schedule it.">
				{#snippet action()}
					<button class="btn btn-accent" onclick={openAdd}>New campaign</button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table>
				<thead>
					<tr>
						<th>Subject</th>
						<th>Kind</th>
						<th>Status</th>
						<th class="right">Recipients</th>
						<th class="right">When</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each campaigns.data as c (c.id)}
						<tr onclick={() => goto(`/admin/newsletter/campaigns/${c.id}`)} style="cursor:pointer">
							<td style="font:500 14px 'Geist', sans-serif;color:var(--ink)">{c.subject || '(no subject)'}</td>
							<td style="color:var(--text-muted);text-transform:capitalize">{c.kind}</td>
							<td><Badge tone={statusTone[c.status] ?? 'grey'} text={c.status} /></td>
							<td class="right mono" style="color:var(--text-muted)">
								{#if c.totalRecipients}{c.sentCount}/{c.totalRecipients}{:else}—{/if}
							</td>
							<td class="right mono" style="color:var(--text-muted)">
								{#if c.sentAt}{new Date(c.sentAt).toLocaleString()}
								{:else if c.scheduledAt}{new Date(c.scheduledAt).toLocaleString()}
								{:else}draft{/if}
							</td>
							<td class="right">
								{#if c.status !== 'sending'}
									<button
										type="button"
										class="btn btn-ghost"
										style="padding:5px 7px;color:var(--stamp-rust)"
										title="Delete campaign"
										onclick={(e) => {
											e.stopPropagation();
											openDelete(c.id);
										}}
									>
										<Icon name="trash" size={13} />
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{/if}
	</div>

	<div>
		<div style="font:600 15px 'Bodoni Moda', serif;color:var(--ink);margin-bottom:10px">Recent subscribers</div>
		{#if subscribers.data && subscribers.data.length > 0}
			<Table>
				<thead>
					<tr>
						<th>Email</th>
						<th>Status</th>
						<th>Source</th>
						<th class="right">Subscribed</th>
					</tr>
				</thead>
				<tbody>
					{#each subscribers.data as s (s.id)}
						<tr>
							<td class="mono" style="color:var(--ink)">{s.email}</td>
							<td><Badge tone={s.status === 'subscribed' ? 'green' : s.status === 'bounced' ? 'rust' : 'grey'} text={s.status} /></td>
							<td style="color:var(--text-muted)">{s.source ?? '—'}</td>
							<td class="right mono" style="color:var(--text-muted)">{new Date(s.subscribedAt).toLocaleDateString()}</td>
						</tr>
					{/each}
				</tbody>
			</Table>
		{:else if subscribers.data}
			<EmptyState title="No subscribers yet" body="Signups from the landing page footer will show up here." />
		{/if}
	</div>
</div>

<Dialog bind:open={addOpen} title="New campaign" note="Start from the default template — you can edit everything after.">
	<form id="add-campaign-form" onsubmit={submitCreate}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Subject</span>
				<input type="text" bind:value={subject} required class="input" />
			</label>
			<label class="field">
				<span class="field-label">Kind</span>
				<select bind:value={kind} class="input">
					<option value="newsletter">Newsletter</option>
					<option value="promotion">Promotion</option>
				</select>
			</label>
		</div>
	</form>
	{#if errorMessage}
		<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={creating}>Cancel</button>
		<button type="submit" form="add-campaign-form" class="btn btn-accent" disabled={creating}>
			{#if creating}<span class="spinner"></span>Creating…{:else}Create campaign{/if}
		</button>
	{/snippet}
</Dialog>

<AlertDialog
	bind:open={deleteOpen}
	title="Delete this campaign?"
	body="This can't be undone. Any recipient records for this campaign are removed too."
	confirmLabel="Delete"
	confirming={deleting}
	onconfirm={doDelete}
/>
