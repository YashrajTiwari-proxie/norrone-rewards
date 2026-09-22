<script lang="ts">
	import Table from '$lib/components/Table.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	const regions = useQuery(api.regions.list, {});
	const createRegion = useMutation(api.regions.create);
	const updateRegion = useMutation(api.regions.update);
	const removeRegion = useMutation(api.regions.remove);

	let addOpen = $state(false);
	let editOpen = $state(false);
	let editingRegionId = $state<Id<'regions'> | null>(null);
	// Derived, not a snapshot — see orgs/[orgId]/tiers/+page.svelte's identical comment.
	let editingRegion = $derived(regions.data?.find((r) => r._id === editingRegionId) ?? null);
	let addSaving = $state(false);
	let editSaving = $state(false);
	let errorMessage = $state<string | null>(null);

	let countryName = $state('');
	let isoCode = $state('');
	let phoneCode = $state('');
	let currencyCode = $state('');
	let currencySymbol = $state('');

	function openAdd() {
		countryName = '';
		isoCode = '';
		phoneCode = '';
		currencyCode = '';
		currencySymbol = '';
		errorMessage = null;
		addOpen = true;
	}

	function openEdit(region: NonNullable<typeof regions.data>[number]) {
		editingRegionId = region._id;
		countryName = region.countryName;
		isoCode = region.isoCode;
		phoneCode = region.phoneCode;
		currencyCode = region.currencyCode;
		currencySymbol = region.currencySymbol;
		errorMessage = null;
		editOpen = true;
	}

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		addSaving = true;
		errorMessage = null;
		try {
			await createRegion({ countryName: countryName.trim(), isoCode: isoCode.trim(), phoneCode: phoneCode.trim(), currencyCode: currencyCode.trim(), currencySymbol: currencySymbol.trim() });
			addOpen = false;
		} catch {
			errorMessage = `A region with ISO code ${isoCode.trim().toUpperCase()} may already exist.`;
		} finally {
			addSaving = false;
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!editingRegion) return;
		editSaving = true;
		errorMessage = null;
		try {
			await updateRegion({
				regionId: editingRegion._id,
				countryName: countryName.trim(),
				isoCode: isoCode.trim(),
				phoneCode: phoneCode.trim(),
				currencyCode: currencyCode.trim(),
				currencySymbol: currencySymbol.trim()
			});
			editOpen = false;
		} catch {
			errorMessage = `A region with ISO code ${isoCode.trim().toUpperCase()} may already exist.`;
		} finally {
			editSaving = false;
		}
	}

	async function deleteRegion() {
		if (!editingRegion) return;
		try {
			await removeRegion({ regionId: editingRegion._id });
			editOpen = false;
		} catch {
			errorMessage = 'Failed to remove region — it may still be in use by an organization or shop.';
		}
	}
</script>

<PageHeader title="Regions" subtitle="Countries the platform supports, with their phone code and default currency.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add a region</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px">
	{#if regions.isLoading}
		<p>Loading…</p>
	{:else if regions.error}
		<p>Failed to load regions: {regions.error.message}</p>
	{:else if regions.data.length === 0}
		<EmptyState title="No regions yet" body="Add a country so organizations and shops can select it during registration.">
			{#snippet action()}
				<button class="btn btn-accent" onclick={openAdd}>Add a region</button>
			{/snippet}
		</EmptyState>
	{:else}
		<Table>
				<thead>
					<tr>
						<th>Country</th>
						<th>ISO code</th>
						<th>Phone code</th>
						<th>Currency</th>
						<th class="right"></th>
					</tr>
				</thead>
				<tbody>
					{#each regions.data as region (region._id)}
						<tr onclick={() => openEdit(region)} style="cursor:pointer">
							<td style="font:500 14px 'Geist', sans-serif;color:var(--ink)">{region.countryName}</td>
							<td class="mono" style="color:var(--text-muted)">{region.isoCode}</td>
							<td class="mono" style="color:var(--text-muted)">{region.phoneCode}</td>
							<td class="mono" style="color:var(--text-muted)">{region.currencyCode} ({region.currencySymbol})</td>
							<td class="right" style="font:500 12px 'Geist', sans-serif;color:var(--stamp-green)">Edit</td>
						</tr>
					{/each}
				</tbody>
			</Table>
	{/if}
</div>

<Drawer bind:open={addOpen} title="Add a region" note="Countries appear alphabetically wherever staff pick one.">
	<form id="add-region-form" onsubmit={submitAdd}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Country name</span>
				<input type="text" bind:value={countryName} required class="input" placeholder="India" />
			</label>
			<label class="field">
				<span class="field-label">ISO code (2 letters)</span>
				<input type="text" bind:value={isoCode} required maxlength="2" class="input mono" placeholder="IN" />
			</label>
			<label class="field">
				<span class="field-label">Phone code</span>
				<input type="text" bind:value={phoneCode} required class="input mono" placeholder="+91" />
			</label>
			<label class="field">
				<span class="field-label">Currency code (ISO 4217)</span>
				<input type="text" bind:value={currencyCode} required maxlength="3" class="input mono" placeholder="INR" />
			</label>
			<label class="field">
				<span class="field-label">Currency symbol</span>
				<input type="text" bind:value={currencySymbol} required class="input mono" placeholder="₹" />
			</label>
		</div>
	</form>
	{#if errorMessage}
		<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={addSaving}>Cancel</button>
		<button type="submit" form="add-region-form" class="btn btn-accent" disabled={addSaving}>
			{#if addSaving}<span class="spinner"></span>Adding…{:else}Add region{/if}
		</button>
	{/snippet}
</Drawer>

<Drawer bind:open={editOpen} title={editingRegion?.countryName ?? ''} note="Update this region's details.">
	{#if editingRegion}
		<form id="edit-region-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Country name</span>
					<input type="text" bind:value={countryName} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">ISO code (2 letters)</span>
					<input type="text" bind:value={isoCode} required maxlength="2" class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Phone code</span>
					<input type="text" bind:value={phoneCode} required class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Currency code (ISO 4217)</span>
					<input type="text" bind:value={currencyCode} required maxlength="3" class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Currency symbol</span>
					<input type="text" bind:value={currencySymbol} required class="input mono" />
				</label>
			</div>
		</form>
		<button type="button" class="btn-danger-text" style="margin-top:4px" onclick={deleteRegion}>Remove this region</button>
	{/if}
	{#if errorMessage}
		<div style="font:400 13px 'Geist', sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
		<button type="submit" form="edit-region-form" class="btn btn-accent" disabled={editSaving}>
			{#if editSaving}<span class="spinner"></span>Saving…{:else}Save region{/if}
		</button>
	{/snippet}
</Drawer>
