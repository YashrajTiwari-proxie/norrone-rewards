<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import GrantBuilder from '$lib/components/GrantBuilder.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const plans = useQuery(api.membershipPlans.list, () => ({ organizationId }));
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));

	const createPlan = useMutation(api.membershipPlans.create);
	const updatePlan = useMutation(api.membershipPlans.update);
	const removePlan = useMutation(api.membershipPlans.remove);
	const addBenefit = useMutation(api.membershipPlans.addBenefit);
	const removeBenefit = useMutation(api.membershipPlans.removeBenefit);

	let addOpen = $state(false);
	let editOpen = $state(false);
	let editingPlanId = $state<Id<'membershipPlans'> | null>(null);
	// Derived, not a snapshot — see tiers/+page.svelte's identical comment.
	let editingPlan = $derived(plans.data?.find((p) => p._id === editingPlanId) ?? null);
	let addSaving = $state(false);
	let editSaving = $state(false);
	let errorMessage = $state<string | null>(null);

	let name = $state('');
	let price = $state('');
	let durationDays = $state('');
	let pointMultiplier = $state('1.0');
	let shopId = $state('');

	function openAdd() {
		name = '';
		price = '';
		durationDays = '';
		pointMultiplier = '1.0';
		shopId = '';
		errorMessage = null;
		addOpen = true;
	}

	function openEdit(plan: NonNullable<typeof plans.data>[number]) {
		editingPlanId = plan._id;
		name = plan.name;
		price = plan.price != null ? String(plan.price) : '';
		durationDays = plan.durationDays != null ? String(plan.durationDays) : '';
		pointMultiplier = String(plan.pointMultiplier);
		shopId = plan.shopId ?? '';
		errorMessage = null;
		editOpen = true;
	}

	// price/durationDays are bound to <input type="number"> — Svelte
	// coerces that binding to a real JS number once the user types
	// anything (only the untouched initial '' stays a string), unlike a
	// text input which always stays a string. Calling .trim() on it
	// unconditionally (the old code) threw "price.trim is not a function"
	// the instant a real value was entered — a client-side exception that
	// never even reached Convex (confirmed live: the mutation never
	// appeared in `npx convex logs` while this was reproduced), silently
	// swallowed by the catch block below as a generic "Failed to create".
	// This handles both possible runtime types safely.
	function numberOrUndefined(value: string | number): number | undefined {
		if (value === '' || value === null || value === undefined) return undefined;
		const n = Number(value);
		return Number.isFinite(n) ? n : undefined;
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
			await createPlan({
				organizationId,
				name: name.trim(),
				price: numberOrUndefined(price),
				durationDays: numberOrUndefined(durationDays),
				pointMultiplier: Number(pointMultiplier) || 1,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			addOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create membership plan.';
		} finally {
			addSaving = false;
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!editingPlan) return;
		if (!name.trim()) {
			errorMessage = 'Name is required.';
			return;
		}
		editSaving = true;
		errorMessage = null;
		try {
			await updatePlan({
				organizationId,
				planId: editingPlan._id,
				name: name.trim(),
				price: numberOrUndefined(price),
				durationDays: numberOrUndefined(durationDays),
				pointMultiplier: Number(pointMultiplier) || 1,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to update membership plan.';
		} finally {
			editSaving = false;
		}
	}

	async function deletePlan() {
		if (!editingPlan) return;
		try {
			await removePlan({ organizationId, planId: editingPlan._id });
			editOpen = false;
		} catch {
			errorMessage = 'Failed to delete membership plan.';
		}
	}
</script>

<PageHeader title="Membership" subtitle="Paid plans customers can subscribe to.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add a plan</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px">
	{#if plans.isLoading}
		<p>Loading…</p>
	{:else if plans.error}
		<p>Failed to load membership plans: {plans.error.message}</p>
	{:else if plans.data.length === 0}
		<EmptyState title="No membership plans yet" body="Create a plan customers can pay for — like a Gold Membership — to unlock a points multiplier or other perks.">
			{#snippet action()}
				<button class="btn btn-accent" onclick={openAdd}>Add a plan</button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="card" style="padding:6px 20px 14px">
			<table>
				<thead>
					<tr>
						<th>Plan</th>
						<th class="right">Price</th>
						<th class="right">Duration</th>
						<th class="right">Points multiplier</th>
						<th>Applies to</th>
						<th class="right">Members</th>
					</tr>
				</thead>
				<tbody>
					{#each plans.data as plan (plan._id)}
						<tr onclick={() => openEdit(plan)} style="cursor:pointer">
							<td>
								<div style="font:500 14px 'IBM Plex Sans',sans-serif;color:var(--ink)">{plan.name}</div>
								{#if plan.benefits.length}
									<div style="margin-top:4px;font:400 12px/1.4 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
										{plan.benefits.length} benefit{plan.benefits.length === 1 ? '' : 's'} granted
									</div>
								{/if}
							</td>
							<td class="right mono" style="font-weight:500;color:var(--ink)">{plan.price != null ? `₹${plan.price}` : 'Free'}</td>
							<td class="right mono" style="color:var(--text-muted)">{plan.durationDays != null ? `${plan.durationDays}d` : 'No expiry'}</td>
							<td class="right mono" style="font-weight:500;color:var(--stamp-amber)">{plan.pointMultiplier}×</td>
							<td style="color:var(--text-muted)">{plan.scopeName}</td>
							<td class="right mono" style="font-weight:500;color:var(--ink)">{plan.activeMembers}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<Drawer bind:open={addOpen} title="Add a membership plan" note="Customers pay this and get its benefits until it expires.">
	<form id="add-plan-form" onsubmit={submitAdd}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Name</span>
				<input type="text" bind:value={name} required class="input" placeholder="Gold Membership" />
			</label>
			<label class="field">
				<span class="field-label">Price (optional — blank means free)</span>
				<input type="number" bind:value={price} step="any" min="0" class="input mono" />
			</label>
			<label class="field">
				<span class="field-label">Duration in days (optional — blank means never expires)</span>
				<input type="number" bind:value={durationDays} min="0" class="input mono" />
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
		<button type="submit" form="add-plan-form" class="btn btn-accent" disabled={addSaving}>
			{#if addSaving}<span class="spinner"></span>Adding…{:else}Add plan{/if}
		</button>
	{/snippet}
</Drawer>

<Drawer bind:open={editOpen} title={editingPlan?.name ?? ''} note="Update this plan's terms or manage what it grants.">
	{#if editingPlan}
		<form id="edit-plan-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Name</span>
					<input type="text" bind:value={name} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">Price (optional — blank means free)</span>
					<input type="number" bind:value={price} step="any" min="0" class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Duration in days (optional — blank means never expires)</span>
					<input type="number" bind:value={durationDays} min="0" class="input mono" />
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
		<GrantBuilder
			benefits={editingPlan.benefits}
			onAdd={(input) => addBenefit({ organizationId, planId: editingPlan!._id, ...input })}
			onRemove={(benefitId) => removeBenefit({ organizationId, benefitId: benefitId as Id<'grantedBenefits'> })}
		/>
		<button type="button" class="btn-danger-text" style="margin-top:4px" onclick={deletePlan}>Delete this plan</button>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
		<button type="submit" form="edit-plan-form" class="btn btn-accent" disabled={editSaving}>
			{#if editSaving}<span class="spinner"></span>Saving…{:else}Save plan{/if}
		</button>
	{/snippet}
</Drawer>
