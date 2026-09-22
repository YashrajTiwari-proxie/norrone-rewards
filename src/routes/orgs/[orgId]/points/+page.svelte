<script lang="ts">
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Table from '$lib/components/Table.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const rules = useQuery(api.pointRules.list, () => ({ organizationId }));
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));

	const createRule = useMutation(api.pointRules.create);
	const updateRule = useMutation(api.pointRules.update);
	const removeRule = useMutation(api.pointRules.remove);

	let addOpen = $state(false);
	let editOpen = $state(false);
	let editingRule = $state<NonNullable<typeof rules.data>[number] | null>(null);
	let addSaving = $state(false);
	let editSaving = $state(false);
	let errorMessage = $state<string | null>(null);

	let actionName = $state('');
	let pointsPerUnit = $state('');
	let memberOnly = $state(false);
	let shopId = $state('');

	const knownActions = ['PURCHASE', 'VISIT', 'REFERRAL'];

	function openAdd() {
		actionName = '';
		pointsPerUnit = '';
		memberOnly = false;
		shopId = '';
		errorMessage = null;
		addOpen = true;
	}

	function openEdit(rule: NonNullable<typeof rules.data>[number]) {
		editingRule = rule;
		actionName = rule.action;
		pointsPerUnit = String(rule.pointsPerUnit);
		memberOnly = rule.memberOnly;
		shopId = rule.shopId ?? '';
		errorMessage = null;
		editOpen = true;
	}

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		const points = Number(pointsPerUnit);
		if (!actionName.trim() || !Number.isFinite(points)) {
			errorMessage = 'Action and points per unit are required.';
			return;
		}
		addSaving = true;
		errorMessage = null;
		try {
			await createRule({
				organizationId,
				action: actionName.trim(),
				pointsPerUnit: points,
				memberOnly,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			addOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create point rule.';
		} finally {
			addSaving = false;
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!editingRule) return;
		const points = Number(pointsPerUnit);
		if (!actionName.trim() || !Number.isFinite(points)) {
			errorMessage = 'Action and points per unit are required.';
			return;
		}
		editSaving = true;
		errorMessage = null;
		try {
			await updateRule({
				organizationId,
				pointRuleId: editingRule._id,
				action: actionName.trim(),
				pointsPerUnit: points,
				memberOnly,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to update point rule.';
		} finally {
			editSaving = false;
		}
	}

	async function deleteRule() {
		if (!editingRule) return;
		try {
			await removeRule({ organizationId, pointRuleId: editingRule._id });
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete point rule.';
		}
	}
</script>

<PageHeader title="Points" subtitle="How customers earn points for what they do.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add a rule</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px">
	{#if rules.isLoading}
		<PageLoading />
	{:else if rules.error}
		<p>Failed to load point rules: {rules.error.message}</p>
	{:else if rules.data.length === 0}
		<EmptyState title="No point rules yet" body="Add a rule — like earning points per purchase or visit — so customers start building a balance.">
			{#snippet action()}
				<button class="btn btn-accent" onclick={openAdd}>Add a rule</button>
			{/snippet}
		</EmptyState>
	{:else}
		<Table>
				<thead>
					<tr>
						<th>Action</th>
						<th class="right">Points earned</th>
						<th>Who it applies to</th>
						<th>Shops</th>
						<th class="right"></th>
					</tr>
				</thead>
				<tbody>
					{#each rules.data as rule (rule._id)}
						<tr onclick={() => openEdit(rule)} style="cursor:pointer">
							<td style="font:500 14px 'Geist', sans-serif;color:var(--ink)">{rule.action}</td>
							<td class="right mono" style="font-weight:500;color:var(--stamp-amber)">+{rule.pointsPerUnit}</td>
							<td>
								{#if rule.memberOnly}
									<Badge tone="amber" text="Members only" />
								{:else}
									<Badge tone="grey" text="Everyone" />
								{/if}
							</td>
							<td style="color:var(--text-muted)">{rule.scopeName}</td>
							<td class="right" style="font:500 12px 'Geist', sans-serif;color:var(--stamp-green)">Edit</td>
						</tr>
					{/each}
				</tbody>
			</Table>
	{/if}
</div>

<Drawer bind:open={addOpen} title="Add a point rule" note="Choose what action earns points, and how many.">
	<form id="add-rule-form" onsubmit={submitAdd}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Action</span>
				<input type="text" bind:value={actionName} required class="input" list="known-actions" placeholder="PURCHASE" />
				<datalist id="known-actions">
					{#each knownActions as a (a)}
						<option value={a}></option>
					{/each}
				</datalist>
			</label>
			<label class="field">
				<span class="field-label">Points per unit</span>
				<input type="number" bind:value={pointsPerUnit} step="any" required min="0" class="input mono" />
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
		<button type="submit" form="add-rule-form" class="btn btn-accent" disabled={addSaving}>
			{#if addSaving}<span class="spinner"></span>Adding…{:else}Add rule{/if}
		</button>
	{/snippet}
</Drawer>

<Drawer bind:open={editOpen} title={editingRule?.action ?? ''} note="Update this point rule.">
	{#if editingRule}
		<form id="edit-rule-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Action</span>
					<input type="text" bind:value={actionName} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">Points per unit</span>
					<input type="number" bind:value={pointsPerUnit} step="any" required min="0" class="input mono" />
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
		<button type="button" class="btn-danger-text" onclick={deleteRule}>Delete this rule</button>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
		<button type="submit" form="edit-rule-form" class="btn btn-accent" disabled={editSaving}>
			{#if editSaving}<span class="spinner"></span>Saving…{:else}Save rule{/if}
		</button>
	{/snippet}
</Drawer>
