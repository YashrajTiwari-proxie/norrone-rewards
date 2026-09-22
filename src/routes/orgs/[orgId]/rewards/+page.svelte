<script lang="ts">
	import PageLoading from '$lib/components/PageLoading.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import ConditionBuilder from '$lib/components/ConditionBuilder.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IdLine from '$lib/components/IdLine.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const rewards = useQuery(api.rewards.list, () => ({ organizationId }));
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));

	const createReward = useMutation(api.rewards.create);
	const updateReward = useMutation(api.rewards.update);
	const removeReward = useMutation(api.rewards.remove);
	const addCondition = useMutation(api.rewards.addCondition);
	const removeCondition = useMutation(api.rewards.removeCondition);

	let addOpen = $state(false);
	let editOpen = $state(false);
	let editingRewardId = $state<Id<'rewardDefinitions'> | null>(null);
	// Derived, not a snapshot — see tiers/+page.svelte's identical comment.
	let editingReward = $derived(rewards.data?.find((r) => r._id === editingRewardId) ?? null);
	let addSaving = $state(false);
	let editSaving = $state(false);
	let errorMessage = $state<string | null>(null);

	let name = $state('');
	let description = $state('');
	let memberOnly = $state(false);
	let shopId = $state('');

	function openAdd() {
		name = '';
		description = '';
		memberOnly = false;
		shopId = '';
		errorMessage = null;
		addOpen = true;
	}

	function openEdit(reward: NonNullable<typeof rewards.data>[number]) {
		editingRewardId = reward._id;
		name = reward.name;
		description = reward.description ?? '';
		memberOnly = reward.memberOnly;
		shopId = reward.shopId ?? '';
		errorMessage = null;
		editOpen = true;
	}

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			errorMessage = 'Name is required.';
			return;
		}
		addSaving = true;
		errorMessage = null;
		try {
			await createReward({
				organizationId,
				name: name.trim(),
				description: description.trim() || undefined,
				memberOnly,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			addOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create reward.';
		} finally {
			addSaving = false;
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!editingReward) return;
		if (!name.trim()) {
			errorMessage = 'Name is required.';
			return;
		}
		editSaving = true;
		errorMessage = null;
		try {
			await updateReward({
				organizationId,
				rewardId: editingReward._id,
				name: name.trim(),
				description: description.trim() || undefined,
				memberOnly,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to update reward.';
		} finally {
			editSaving = false;
		}
	}

	let deleteConfirmOpen = $state(false);
	let deleting = $state(false);

	async function deleteReward() {
		if (!editingReward) return;
		deleting = true;
		try {
			await removeReward({ organizationId, rewardId: editingReward._id });
			deleteConfirmOpen = false;
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete reward.';
		} finally {
			deleting = false;
		}
	}
</script>

<PageHeader title="Rewards" subtitle="Non-monetary perks customers earn by qualifying.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add a reward</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px">
	{#if rewards.isLoading}
		<PageLoading />
	{:else if rewards.error}
		<p>Failed to load rewards: {rewards.error.message}</p>
	{:else if rewards.data.length === 0}
		<EmptyState title="No rewards yet" body="Create a reward — like a free dessert after 3 visits — and it's granted automatically the moment a customer qualifies.">
			{#snippet action()}
				<button class="btn btn-accent" onclick={openAdd}>Add a reward</button>
			{/snippet}
		</EmptyState>
	{:else}
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px">
			{#each rewards.data as reward (reward._id)}
				<div
					onclick={() => openEdit(reward)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && openEdit(reward)}
					role="button"
					tabindex="0"
					style="cursor:pointer;display:flex;background:var(--card);border:1px solid var(--line);border-radius:12px;min-height:132px"
				>
					<div style="flex:1;min-width:0;padding:18px 20px;display:flex;flex-direction:column;justify-content:space-between">
						<div>
							<div style="font:600 15px/1.3 'Bodoni Moda', serif;color:var(--ink)">{reward.name}</div>
							<div style="margin-top:5px" onclick={(e) => e.stopPropagation()} role="presentation">
								<IdLine id={reward._id} compact />
							</div>
							{#if reward.description}
								<div style="margin-top:7px;font:400 13px/1.5 'Geist', sans-serif;color:var(--text-muted)">
									{reward.description}
								</div>
							{/if}
						</div>
						<div style="margin-top:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
							<Badge tone="grey" mono text={reward.conditionSummary} />
							{#if reward.memberOnly}<Badge tone="amber" text="Members only" />{/if}
						</div>
					</div>
					<div class="stub-perforation"></div>
					<div class="stub-end">
						<div style="text-align:center">
							<div style="width:34px;height:34px;margin:0 auto;border:1.5px dashed var(--stamp-green);border-radius:50%;transform:rotate(-8deg)"></div>
							<div style="margin-top:10px;font:500 9px/1.4 'Geist', sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--stamp-green)">On the house</div>
							<div class="mono" style="margin-top:8px;font:500 12px/1 'Geist Mono', monospace;color:var(--text-muted)">{reward.grantedCount} granted</div>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<Drawer bind:open={addOpen} title="Add a reward" note="Describe the perk and who qualifies.">
	<form id="add-reward-form" onsubmit={submitAdd}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Name</span>
				<input type="text" bind:value={name} required class="input" placeholder="Free Dessert" />
			</label>
			<label class="field">
				<span class="field-label">Description</span>
				<input type="text" bind:value={description} class="input" placeholder="On the house" />
			</label>
			<label style="display:flex;align-items:center;gap:8px">
				<input type="checkbox" bind:checked={memberOnly} />
				<span class="field-label">Members only</span>
			</label>
			<label class="field">
				<span class="field-label">Applies to</span>
				<select bind:value={shopId} class="input">
					<option value="">All shops</option>
					{#each org.data?.shops ?? [] as shop (shop._id)}
						<option value={shop._id}>{shop.name}</option>
					{/each}
				</select>
			</label>
		</div>
	</form>
	{#if errorMessage}
		<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={addSaving}>Cancel</button>
		<button type="submit" form="add-reward-form" class="btn btn-accent" disabled={addSaving}>
			{#if addSaving}<span class="spinner"></span>Adding…{:else}Add reward{/if}
		</button>
	{/snippet}
</Drawer>

<Drawer bind:open={editOpen} title={editingReward?.name ?? ''} note="Update this reward and who qualifies.">
	{#if editingReward}
		<div style="margin-bottom:16px">
			<IdLine id={editingReward._id} compact />
		</div>
		<form id="edit-reward-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Name</span>
					<input type="text" bind:value={name} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">Description</span>
					<input type="text" bind:value={description} class="input" />
				</label>
				<label style="display:flex;align-items:center;gap:8px">
					<input type="checkbox" bind:checked={memberOnly} />
					<span class="field-label">Members only</span>
				</label>
				<label class="field">
					<span class="field-label">Applies to</span>
					<select bind:value={shopId} class="input">
						<option value="">All shops</option>
						{#each org.data?.shops ?? [] as shop (shop._id)}
							<option value={shop._id}>{shop.name}</option>
						{/each}
					</select>
				</label>
			</div>
		</form>
		<ConditionBuilder
			conditions={editingReward.conditions}
			onAdd={(input) => addCondition({ organizationId, rewardId: editingReward!._id, ...input } as never)}
			onRemove={(conditionId) => removeCondition({ organizationId, conditionId: conditionId as Id<'eligibilityConditions'> })}
		/>
		<button type="button" class="btn-danger-text" style="margin-top:4px" onclick={() => (deleteConfirmOpen = true)}>Delete this reward</button>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
		<button type="submit" form="edit-reward-form" class="btn btn-accent" disabled={editSaving}>
			{#if editSaving}<span class="spinner"></span>Saving…{:else}Save reward{/if}
		</button>
	{/snippet}
</Drawer>

<AlertDialog
	bind:open={deleteConfirmOpen}
	title="Delete this reward?"
	body="This reward will no longer be granted or shown to customers. This can't be undone."
	confirmLabel="Delete reward"
	confirming={deleting}
	onconfirm={deleteReward}
/>
