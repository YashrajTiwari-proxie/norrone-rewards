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

	let search = $state('');

	const badgeTones = [
		{ bg: 'var(--stamp-green-bg)', fg: 'var(--stamp-green)' },
		{ bg: 'var(--stamp-amber-bg)', fg: 'var(--stamp-amber)' },
		{ bg: 'var(--stamp-rust-bg)', fg: 'var(--stamp-rust)' },
		{ bg: 'var(--stamp-grey-bg)', fg: 'var(--text-muted)' }
	];
	function toneFor(orgName: string) {
		let hash = 0;
		for (let i = 0; i < orgName.length; i++) hash = (hash * 31 + orgName.charCodeAt(i)) | 0;
		return badgeTones[Math.abs(hash) % badgeTones.length];
	}
	function initialsFor(orgName: string): string {
		const parts = orgName.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}

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

<div class="admin-orgs" style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:38px">
	{#if orgs.isLoading}
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
			{#each Array(3) as _}
				<div class="card skeleton" style="height:88px"></div>
			{/each}
		</div>
		<div class="card" style="padding:6px 20px 14px;display:flex;flex-direction:column;gap:12px">
			{#each Array(5) as _}
				<div class="skeleton" style="height:44px;border-radius:8px"></div>
			{/each}
		</div>
	{:else if orgs.error}
		<p>Failed to load organizations: {orgs.error.message}</p>
	{:else}
		{@const data = orgs.data}
		{@const filtered = data.organizations.filter((org) =>
			org.name.toLowerCase().includes(search.trim().toLowerCase())
		)}
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
			<input
				type="text"
				bind:value={search}
				placeholder="Search organizations…"
				class="input"
				style="max-width:320px"
			/>

			{#if filtered.length === 0}
				<EmptyState title="No matches" body={`No organization name matches "${search}".`} />
			{:else}
				<div class="card org-table-card" style="padding:6px 20px 14px">
					<table class="org-table">
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
							{#each filtered as org (org._id)}
								<tr
									class="org-row"
									onclick={() => (window.location.href = `/admin/orgs/${org._id}`)}
									style="cursor:pointer"
								>
									<td>
										<div style="display:flex;align-items:center;gap:12px">
											<span
											class="org-avatar"
											style="background:{toneFor(org.name).bg};color:{toneFor(org.name).fg}"
											>{initialsFor(org.name)}</span
										>
											<span style="font:500 14px 'Inter',sans-serif;color:var(--ink)">{org.name}</span>
										</div>
									</td>
									<td class="right mono" data-label="Shops" style="color:var(--ink)">{org.counts.shops}</td>
									<td class="right mono" data-label="Customers" style="color:var(--ink)">{org.counts.customers}</td>
									<td class="right mono" data-label="Staff" style="color:var(--ink)">{org.counts.staff}</td>
									<td class="right mono" data-label="Created" style="color:var(--text-muted)"
										>{new Date(org._creationTime).toLocaleDateString()}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.skeleton {
		background: linear-gradient(90deg, var(--line-2) 25%, var(--surface-soft) 37%, var(--line-2) 63%);
		background-size: 400% 100%;
		animation: skeletonShine 1.4s ease infinite;
	}
	@keyframes skeletonShine {
		0% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0 50%;
		}
	}

	.org-avatar {
		width: 30px;
		height: 30px;
		flex: 0 0 30px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		font: 600 11px/1 'Inter', sans-serif;
	}

	.org-row:hover {
		background: var(--surface-soft);
	}

	@media (max-width: 640px) {
		.org-table thead {
			display: none;
		}
		.org-table,
		.org-table tbody,
		.org-table tr,
		.org-table td {
			display: block;
			width: 100%;
		}
		.org-table tr {
			padding: 12px 0;
			border-bottom: 1px solid var(--line-2);
		}
		.org-table td {
			border: 0;
			padding: 4px 0;
			text-align: left !important;
		}
		.org-table td.right::before {
			content: attr(data-label) ': ';
			color: var(--text-muted);
			font-family: 'Inter', sans-serif;
		}
	}
</style>

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
		<div style="font:400 13px 'Inter',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={saving}>Cancel</button>
		<button type="submit" form="add-org-form" class="btn btn-accent" disabled={saving}>
			{#if saving}<span class="spinner"></span>Adding…{:else}Add organization{/if}
		</button>
	{/snippet}
</Drawer>
