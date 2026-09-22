<script lang="ts">
	import PageLoading from '$lib/components/PageLoading.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import TierStamp from '$lib/components/TierStamp.svelte';
	import ConditionBuilder from '$lib/components/ConditionBuilder.svelte';
	import GrantBuilder from '$lib/components/GrantBuilder.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IdLine from '$lib/components/IdLine.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const tiers = useQuery(api.tiers.list, () => ({ organizationId }));
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));

	const createTier = useMutation(api.tiers.create);
	const updateTier = useMutation(api.tiers.update);
	const removeTier = useMutation(api.tiers.remove);
	const addCondition = useMutation(api.tiers.addCondition);
	const removeCondition = useMutation(api.tiers.removeCondition);
	const addBenefit = useMutation(api.tiers.addBenefit);
	const removeBenefit = useMutation(api.tiers.removeBenefit);

	let addOpen = $state(false);
	let editOpen = $state(false);
	let editingTierId = $state<Id<'tiers'> | null>(null);
	// Derived (not a snapshot) so ConditionBuilder/GrantBuilder inside the
	// drawer see live updates after adding/removing a condition or benefit —
	// tiers.data is a whole new array on every reactive update, so a plain
	// `editingTier = tier` assignment at open time would go stale the
	// moment the first condition/benefit is added.
	let editingTier = $derived(tiers.data?.find((t) => t._id === editingTierId) ?? null);
	let addSaving = $state(false);
	let editSaving = $state(false);
	let errorMessage = $state<string | null>(null);

	let name = $state('');
	let level = $state('');
	let pointMultiplier = $state('1.0');
	let shopId = $state('');

	function openAdd() {
		name = '';
		level = '';
		pointMultiplier = '1.0';
		shopId = '';
		errorMessage = null;
		addOpen = true;
	}

	function openEdit(tier: NonNullable<typeof tiers.data>[number]) {
		editingTierId = tier._id;
		name = tier.name;
		level = String(tier.level);
		pointMultiplier = String(tier.pointMultiplier);
		shopId = tier.shopId ?? '';
		errorMessage = null;
		editOpen = true;
	}

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		const levelNum = Number(level);
		if (!name.trim() || !Number.isFinite(levelNum)) {
			errorMessage = 'Name and level are required.';
			return;
		}
		addSaving = true;
		errorMessage = null;
		try {
			await createTier({
				organizationId,
				name: name.trim(),
				level: levelNum,
				pointMultiplier: Number(pointMultiplier) || 1,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			addOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create tier.';
		} finally {
			addSaving = false;
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!editingTier) return;
		const levelNum = Number(level);
		if (!name.trim() || !Number.isFinite(levelNum)) {
			errorMessage = 'Name and level are required.';
			return;
		}
		editSaving = true;
		errorMessage = null;
		try {
			await updateTier({
				organizationId,
				tierId: editingTier._id,
				name: name.trim(),
				level: levelNum,
				pointMultiplier: Number(pointMultiplier) || 1,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to update tier.';
		} finally {
			editSaving = false;
		}
	}

	let deleteConfirmOpen = $state(false);
	let deleting = $state(false);

	async function deleteTier() {
		if (!editingTier) return;
		deleting = true;
		try {
			await removeTier({ organizationId, tierId: editingTier._id });
			deleteConfirmOpen = false;
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete tier.';
		} finally {
			deleting = false;
		}
	}

	const stampColors = ['var(--stamp-amber)', 'var(--stamp-green)', 'var(--stamp-rust)', '#6E6C61'];
</script>

<PageHeader title="Tiers" subtitle="Status levels customers climb automatically as they qualify.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add a tier</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px">
	{#if tiers.isLoading}
		<PageLoading />
	{:else if tiers.error}
		<p>Failed to load tiers: {tiers.error.message}</p>
	{:else if tiers.data.length === 0}
		<EmptyState title="No tiers yet" body="Create tiers like Bronze, Silver, and Gold — customers move up automatically once they meet the conditions you set.">
			{#snippet action()}
				<button class="btn btn-accent" onclick={openAdd}>Add a tier</button>
			{/snippet}
		</EmptyState>
	{:else}
		<div style="display:flex;flex-direction:column;gap:12px">
			{#each tiers.data as tier, i (tier._id)}
				<div
					class="card"
					style="padding:20px 22px;display:grid;grid-template-columns:auto minmax(0,1fr) minmax(70px,auto) minmax(80px,auto) auto;align-items:center;gap:20px"
				>
					<TierStamp name={tier.name} level={tier.level} color={stampColors[i % stampColors.length]} />
					<div style="min-width:0">
						<div style="font:500 15px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink)">{tier.name}</div>
						<div style="margin-top:6px;font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
							{tier.conditionSummary} · {tier.scopeName}
						</div>
						<div style="margin-top:4px"><IdLine id={tier._id} compact /></div>
					</div>
					<div style="text-align:right">
						<div style="font:500 10px/1 'IBM Plex Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)">Multiplier</div>
						<div class="mono" style="margin-top:6px;font:500 20px/1 'IBM Plex Mono',monospace;color:var(--stamp-amber)">{tier.pointMultiplier}×</div>
					</div>
					<div style="text-align:right">
						<div style="font:500 10px/1 'IBM Plex Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)">Customers</div>
						<div class="mono" style="margin-top:6px;font:500 20px/1 'IBM Plex Mono',monospace;color:var(--ink)">{tier.customers}</div>
					</div>
					<button class="btn btn-outline" onclick={() => openEdit(tier)}>Edit</button>
				</div>
			{/each}
		</div>
	{/if}
</div>

<Drawer bind:open={addOpen} title="Add a tier" note="Set the level and the multiplier it grants.">
	<form id="add-tier-form" onsubmit={submitAdd}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Name</span>
				<input type="text" bind:value={name} required class="input" placeholder="Gold" />
			</label>
			<label class="field">
				<span class="field-label">Level</span>
				<input type="number" bind:value={level} required min="0" class="input mono" />
			</label>
			<label class="field">
				<span class="field-label">Points multiplier</span>
				<input type="number" bind:value={pointMultiplier} step="any" min="0" class="input mono" />
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
		<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={addSaving}>Cancel</button>
		<button type="submit" form="add-tier-form" class="btn btn-accent" disabled={addSaving}>
			{#if addSaving}<span class="spinner"></span>Adding…{:else}Add tier{/if}
		</button>
	{/snippet}
</Drawer>

<Drawer bind:open={editOpen} title={editingTier?.name ?? ''} note="Update this tier, who qualifies, and what it grants.">
	{#if editingTier}
		<div style="margin-bottom:16px">
			<IdLine id={editingTier._id} compact />
		</div>
		<form id="edit-tier-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Name</span>
					<input type="text" bind:value={name} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">Level</span>
					<input type="number" bind:value={level} required min="0" class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Points multiplier</span>
					<input type="number" bind:value={pointMultiplier} step="any" min="0" class="input mono" />
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
			conditions={editingTier.conditions}
			onAdd={(input) => addCondition({ organizationId, tierId: editingTier!._id, ...input } as never)}
			onRemove={(conditionId) => removeCondition({ organizationId, conditionId: conditionId as Id<'eligibilityConditions'> })}
		/>
		<GrantBuilder
			benefits={editingTier.benefits}
			onAdd={(input) => addBenefit({ organizationId, tierId: editingTier!._id, ...input })}
			onRemove={(benefitId) => removeBenefit({ organizationId, benefitId: benefitId as Id<'grantedBenefits'> })}
		/>
		<button type="button" class="btn-danger-text" style="margin-top:4px" onclick={() => (deleteConfirmOpen = true)}>Delete this tier</button>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
		<button type="submit" form="edit-tier-form" class="btn btn-accent" disabled={editSaving}>
			{#if editSaving}<span class="spinner"></span>Saving…{:else}Save tier{/if}
		</button>
	{/snippet}
</Drawer>

<AlertDialog
	bind:open={deleteConfirmOpen}
	title="Delete this tier?"
	body="Customers currently at this tier will lose it. This can't be undone."
	confirmLabel="Delete tier"
	confirming={deleting}
	onconfirm={deleteTier}
/>
