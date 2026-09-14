<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import StatTicket from '$lib/components/StatTicket.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RegionCurrencyFields from '$lib/components/RegionCurrencyFields.svelte';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api';
	import type { Id } from '../../../../convex/_generated/dataModel';

	const orgs = useQuery(api.adminOrganizations.list, {});
	const regions = useQuery(api.regions.list, {});
	const createOrg = useMutation(api.adminOrganizations.create);

	let addOpen = $state(false);
	let saving = $state(false);
	let errorMessage = $state<string | null>(null);

	let name = $state('');
	let ownerEmail = $state('');
	let phoneNumber = $state('');
	let website = $state('');
	let address = $state('');
	let regionId = $state('');
	let currencyCode = $state('');
	let businessRegistrationNumber = $state('');
	let taxId = $state('');

	function openAdd() {
		name = '';
		ownerEmail = '';
		phoneNumber = '';
		website = '';
		address = '';
		regionId = '';
		currencyCode = '';
		businessRegistrationNumber = '';
		taxId = '';
		errorMessage = null;
		addOpen = true;
	}

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			errorMessage = 'Organization name is required.';
			return;
		}
		saving = true;
		errorMessage = null;
		try {
			await createOrg({
				name: name.trim(),
				phoneNumber: phoneNumber.trim() || undefined,
				website: website.trim() || undefined,
				address: address.trim() || undefined,
				regionId: (regionId || undefined) as Id<'regions'> | undefined,
				currencyCode: currencyCode.trim() ? currencyCode.trim().toUpperCase() : undefined,
				businessRegistrationNumber: businessRegistrationNumber.trim() || undefined,
				taxId: taxId.trim() || undefined,
				ownerEmail: ownerEmail.trim() || undefined
			});
			addOpen = false;
		} catch {
			errorMessage = 'Failed to create organization.';
		} finally {
			saving = false;
		}
	}
</script>

<PageHeader title="Organizations" subtitle="Every organization running on the platform.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add an organization</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:38px">
	{#if orgs.isLoading}
		<p>Loading…</p>
	{:else if orgs.error}
		<p>Failed to load organizations: {orgs.error.message}</p>
	{:else}
		{@const data = orgs.data}
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
			<StatTicket label="Organizations" value={data.platformStats.totalOrgs.toLocaleString()} />
			<StatTicket label="Shops" value={data.platformStats.totalShops.toLocaleString()} />
			<StatTicket label="Customers" value={data.platformStats.totalCustomers.toLocaleString()} />
		</div>

		{#if data.organizations.length === 0}
			<EmptyState title="No organizations yet" body="Add the first organization to get them set up on the platform.">
				{#snippet action()}
					<button class="btn btn-accent" onclick={openAdd}>Add an organization</button>
				{/snippet}
			</EmptyState>
		{:else}
			<div class="card" style="padding:6px 20px 14px">
				<table>
					<thead>
						<tr>
							<th>Organization</th>
							<th class="right">Shops</th>
							<th class="right">Customers</th>
							<th class="right">Staff</th>
							<th class="right">Created</th>
						</tr>
					</thead>
					<tbody>
						{#each data.organizations as org (org._id)}
							<tr onclick={() => (window.location.href = `/admin/orgs/${org._id}`)} style="cursor:pointer">
								<td style="font:500 14px 'IBM Plex Sans',sans-serif;color:var(--ink)">{org.name}</td>
								<td class="right mono" style="color:var(--ink)">{org.counts.shops}</td>
								<td class="right mono" style="color:var(--ink)">{org.counts.customers}</td>
								<td class="right mono" style="color:var(--ink)">{org.counts.staff}</td>
								<td class="right mono" style="color:var(--text-muted)">{new Date(org._creationTime).toLocaleDateString()}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

<Drawer bind:open={addOpen} title="Add an organization" note="Optionally add an owner (they must already have an account) to get them started right away.">
	<form id="add-org-form" onsubmit={submitAdd}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Organization name</span>
				<input type="text" bind:value={name} required class="input" placeholder="Kettle &amp; Coal" />
			</label>
			<label class="field">
				<span class="field-label">Owner email (optional — must already have an account)</span>
				<input type="email" bind:value={ownerEmail} class="input" placeholder="owner@restaurant.com" />
			</label>
			<label class="field">
				<span class="field-label">Phone number</span>
				<input type="tel" bind:value={phoneNumber} class="input" placeholder="+91 98200 12345" />
			</label>
			<label class="field">
				<span class="field-label">Website (optional)</span>
				<input type="url" bind:value={website} class="input" placeholder="https://kettleandcoal.com" />
			</label>
			<label class="field">
				<span class="field-label">Address</span>
				<input type="text" bind:value={address} class="input" />
			</label>
			<RegionCurrencyFields regions={regions.data ?? []} bind:regionId bind:currencyCode />
			<label class="field">
				<span class="field-label">Business registration number</span>
				<input type="text" bind:value={businessRegistrationNumber} class="input mono" placeholder="Optional" />
			</label>
			<label class="field">
				<span class="field-label">Tax ID (GST / VAT / EIN)</span>
				<input type="text" bind:value={taxId} class="input mono" placeholder="Optional" />
			</label>
		</div>
	</form>
	{#if errorMessage}
		<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={saving}>Cancel</button>
		<button type="submit" form="add-org-form" class="btn btn-accent" disabled={saving}>
			{#if saving}<span class="spinner"></span>Adding…{:else}Add organization{/if}
		</button>
	{/snippet}
</Drawer>
