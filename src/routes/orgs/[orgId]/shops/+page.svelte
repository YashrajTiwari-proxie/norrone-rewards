<script lang="ts">
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Table from '$lib/components/Table.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import RegionCurrencyFields from '$lib/components/RegionCurrencyFields.svelte';
	import StatTicket from '$lib/components/StatTicket.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const shops = useQuery(api.shops.list, () => ({ organizationId }));
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));
	const regions = useQuery(api.regions.list, {});
	const overview = useQuery(api.dashboard.getOverview, () => ({ organizationId }));
	const createShop = useMutation(api.shops.create);
	const updateShop = useMutation(api.shops.update);

	function openShop(shopId: string) {
		goto(`/orgs/${organizationId}?shop=${shopId}`);
	}

	let drawerOpen = $state(false);
	let saving = $state(false);
	let editOpen = $state(false);
	let editSaving = $state(false);
	let editingShop = $state<NonNullable<typeof shops.data>[number] | null>(null);
	let errorMessage = $state<string | null>(null);
	let shopIdCopied = $state(false);

	function copyShopId(id: string) {
		navigator.clipboard.writeText(id);
		shopIdCopied = true;
		setTimeout(() => (shopIdCopied = false), 1500);
	}

	let name = $state('');
	let externalShopId = $state('');
	let phoneNumber = $state('');
	let address = $state('');
	let regionId = $state('');
	let currencyCode = $state('');

	function openAdd() {
		name = '';
		externalShopId = '';
		phoneNumber = org.data?.organization.phoneNumber ?? '';
		address = org.data?.organization.address ?? '';
		regionId = org.data?.organization.regionId ?? '';
		currencyCode = org.data?.organization.currencyCode ?? '';
		errorMessage = null;
		drawerOpen = true;
	}

	function openEdit(shop: NonNullable<typeof shops.data>[number]) {
		editingShop = shop;
		name = shop.name;
		externalShopId = shop.externalShopId ?? '';
		phoneNumber = shop.phoneNumber ?? '';
		address = shop.address ?? '';
		regionId = shop.regionId ?? '';
		currencyCode = shop.currencyCode ?? '';
		errorMessage = null;
		editOpen = true;
	}

	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		errorMessage = null;
		try {
			await createShop({
				organizationId,
				name: name.trim(),
				externalShopId: externalShopId.trim() || undefined,
				phoneNumber: phoneNumber.trim() || undefined,
				address: address.trim() || undefined,
				regionId: (regionId || undefined) as Id<'regions'> | undefined,
				currencyCode: currencyCode.trim() ? currencyCode.trim().toUpperCase() : undefined
			});
			drawerOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create shop.';
		} finally {
			saving = false;
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!editingShop) return;
		editSaving = true;
		errorMessage = null;
		try {
			await updateShop({
				organizationId,
				shopId: editingShop._id,
				name: name.trim(),
				externalShopId: externalShopId.trim() || undefined,
				phoneNumber: phoneNumber.trim() || undefined,
				address: address.trim() || undefined,
				regionId: (regionId || undefined) as Id<'regions'> | undefined,
				currencyCode: currencyCode.trim() ? currencyCode.trim().toUpperCase() : undefined
			});
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to update shop.';
		} finally {
			editSaving = false;
		}
	}
</script>

<PageHeader title="Shops" subtitle="All locations at a glance. Click a shop to open its own dashboard.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add a shop</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:26px">
	{#if overview.data && !overview.isLoading}
		{@const data = overview.data}
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
			<StatTicket label="Shops" value={(shops.data?.length ?? 0).toLocaleString()} note="All locations" />
			<StatTicket label="Customers" value={data.stats.customerCount.toLocaleString()} note="Across every shop" />
			<StatTicket label="Active members" value={data.stats.activeMemberCount.toLocaleString()} note="Paid membership, not expired" />
			<StatTicket label="Points issued" value={data.stats.pointsIssuedTotal.toLocaleString()} note="Last 12 weeks" />
		</div>
	{/if}

	{#if shops.isLoading}
		<PageLoading />
	{:else if shops.error}
		<p>Failed to load shops: {shops.error.message}</p>
	{:else if shops.data.length === 0}
		<EmptyState title="No shops yet" body="Add your first shop to start creating customers and configuring the program for it.">
			{#snippet action()}
				<button class="btn btn-accent" onclick={openAdd}>Add a shop</button>
			{/snippet}
		</EmptyState>
	{:else}
		<Table>
				<thead>
					<tr>
						<th>Shop</th>
						<th>Shop ID in your system</th>
						<th>Country</th>
						<th>Currency</th>
						<th class="right">Customers</th>
						<th class="right">Added</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each shops.data as shop (shop._id)}
						<tr onclick={() => openShop(shop._id)} style="cursor:pointer">
							<td style="font:500 14px 'Inter',sans-serif;color:var(--ink)">{shop.name}</td>
							<td class="mono" style="color:var(--text-muted)">{shop.externalShopId ?? '—'}</td>
							<td style="color:var(--text-muted)">{shop.regionName ?? '—'}</td>
							<td class="mono" style="color:var(--text-muted)">{shop.currencyCode ?? '—'}</td>
							<td class="right mono" style="font-weight:500;color:var(--ink)">{shop.customerCount}</td>
							<td class="right mono" style="color:var(--text-muted)">
								{new Date(shop._creationTime).toLocaleDateString()}
							</td>
							<td class="right">
								<button
									type="button"
									class="btn btn-outline"
									style="padding:5px 11px;font-size:12px"
									onclick={(e) => {
										e.stopPropagation();
										openEdit(shop);
									}}
								>
									Edit
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</Table>
	{/if}
</div>

<Drawer bind:open={drawerOpen} title="Add a shop" note="Give it a name your staff will recognize. Location details default from your organization but can be changed for this shop.">
	<form id="drawer-form" onsubmit={submitCreate}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Name</span>
				<input type="text" bind:value={name} required class="input" placeholder="Kettle &amp; Coal — Fort" />
			</label>
			<label class="field">
				<span class="field-label">External shop ID</span>
				<input type="text" bind:value={externalShopId} class="input mono" placeholder="Optional — your own reference" />
			</label>
			<label class="field">
				<span class="field-label">Phone number</span>
				<input type="tel" bind:value={phoneNumber} class="input" />
			</label>
			<label class="field">
				<span class="field-label">Address</span>
				<input type="text" bind:value={address} class="input" />
			</label>
			<RegionCurrencyFields regions={regions.data ?? []} bind:regionId bind:currencyCode />
		</div>
	</form>
	{#if errorMessage}
		<div style="font:400 13px 'Inter',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (drawerOpen = false)} disabled={saving}>Cancel</button>
		<button type="submit" form="drawer-form" class="btn btn-accent" disabled={saving}>
			{#if saving}<span class="spinner"></span>Adding…{:else}Add shop{/if}
		</button>
	{/snippet}
</Drawer>

<Drawer bind:open={editOpen} title={editingShop?.name ?? ''} note="This shop's own location and currency — independent of the organization's defaults.">
	{#if editingShop}
		<form id="edit-shop-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<div class="field">
					<span class="field-label">API Shop ID — use this in /v1/shops/:shopId/... calls</span>
					<div style="display:flex;gap:8px;align-items:center">
						<code class="mono" style="flex:1;background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;padding:9px 12px;font-size:13px;overflow-x:auto;white-space:nowrap">
							{editingShop._id}
						</code>
						<button
							type="button"
							class="btn btn-outline"
							style="flex:none"
							onclick={() => copyShopId(editingShop!._id)}
						>
							{shopIdCopied ? 'Copied!' : 'Copy'}
						</button>
					</div>
					<span style="font:400 12px 'Inter',sans-serif;color:var(--text-muted);margin-top:4px;display:block">
						Not the same as "External shop ID" below (that's your own reference number). See
						<a href="/orgs/{organizationId}/api-keys">API Keys</a> for a full reference.
					</span>
				</div>
				<label class="field">
					<span class="field-label">Name</span>
					<input type="text" bind:value={name} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">External shop ID</span>
					<input type="text" bind:value={externalShopId} class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Phone number</span>
					<input type="tel" bind:value={phoneNumber} class="input" />
				</label>
				<label class="field">
					<span class="field-label">Address</span>
					<input type="text" bind:value={address} class="input" />
				</label>
				<RegionCurrencyFields regions={regions.data ?? []} bind:regionId bind:currencyCode />
			</div>
		</form>
	{/if}
	{#if errorMessage}
		<div style="font:400 13px 'Inter',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
		<button type="submit" form="edit-shop-form" class="btn btn-accent" disabled={editSaving}>
			{#if editSaving}<span class="spinner"></span>Saving…{:else}Save shop{/if}
		</button>
	{/snippet}
</Drawer>
