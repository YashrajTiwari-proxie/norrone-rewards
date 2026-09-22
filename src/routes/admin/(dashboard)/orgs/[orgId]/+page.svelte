<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import StatTicket from '$lib/components/StatTicket.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import RegionCurrencyFields from '$lib/components/RegionCurrencyFields.svelte';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../../convex/_generated/api';
	import type { Id } from '../../../../../../convex/_generated/dataModel';

	let targetOrganizationId = $derived(page.params.orgId as Id<'organizations'>);
	const detail = useQuery(api.adminOrganizations.get, () => ({ targetOrganizationId }));
	const regions = useQuery(api.regions.list, {});

	const updateOrg = useMutation(api.adminOrganizations.update);
	const removeOrg = useMutation(api.adminOrganizations.remove);

	let editOpen = $state(false);
	let deleteOpen = $state(false);
	let confirmName = $state('');
	let editSaving = $state(false);
	let deleteSaving = $state(false);
	let errorMessage = $state<string | null>(null);

	let name = $state('');
	let phoneNumber = $state('');
	let website = $state('');
	let address = $state('');
	let regionId = $state('');
	let currencyCode = $state('');
	let businessRegistrationNumber = $state('');
	let taxId = $state('');

	function openEdit() {
		const org = detail.data?.organization;
		if (!org) return;
		name = org.name;
		phoneNumber = org.phoneNumber ?? '';
		website = org.website ?? '';
		address = org.address ?? '';
		regionId = org.regionId ?? '';
		currencyCode = org.currencyCode ?? '';
		businessRegistrationNumber = org.businessRegistrationNumber ?? '';
		taxId = org.taxId ?? '';
		errorMessage = null;
		editOpen = true;
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) {
			errorMessage = 'Name is required.';
			return;
		}
		editSaving = true;
		errorMessage = null;
		try {
			await updateOrg({
				targetOrganizationId,
				name: name.trim(),
				phoneNumber: phoneNumber.trim() || undefined,
				website: website.trim() || undefined,
				address: address.trim() || undefined,
				regionId: (regionId || undefined) as Id<'regions'> | undefined,
				currencyCode: currencyCode.trim() ? currencyCode.trim().toUpperCase() : undefined,
				businessRegistrationNumber: businessRegistrationNumber.trim() || undefined,
				taxId: taxId.trim() || undefined
			});
			editOpen = false;
		} catch {
			errorMessage = 'Failed to update organization.';
		} finally {
			editSaving = false;
		}
	}

	async function submitDelete(event: SubmitEvent) {
		event.preventDefault();
		deleteSaving = true;
		errorMessage = null;
		try {
			await removeOrg({ targetOrganizationId, confirmName });
			await goto('/admin');
		} catch {
			errorMessage = 'Type the exact organization name to confirm deletion.';
			deleteSaving = false;
		}
	}
</script>

{#if detail.isLoading}
	<div style="padding:40px">Loading…</div>
{:else if detail.error}
	<div style="padding:40px">Failed to load organization: {detail.error.message}</div>
{:else}
	{@const data = detail.data}
	<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:34px">
		<a href="/admin" style="align-self:flex-start;font:500 13px 'IBM Plex Sans',sans-serif">← Back to organizations</a>

		<div class="card" style="padding:26px 28px;display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap">
			<div>
				<div style="font:600 22px/1.2 'IBM Plex Sans',sans-serif;letter-spacing:-.01em;color:var(--ink)">{data.organization.name}</div>
				<div style="margin-top:7px;font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					Created {new Date(data.organization._creationTime).toLocaleDateString()}
					{#if data.organization.regionName} · {data.organization.regionName}{/if}
					{#if data.organization.currencyCode} · {data.organization.currencyCode}{/if}
				</div>
				{#if data.organization.phoneNumber || data.organization.website || data.organization.address}
					<div style="margin-top:10px;font:400 13px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
						{#if data.organization.phoneNumber}{data.organization.phoneNumber}<br />{/if}
						{#if data.organization.website}<a href={data.organization.website} target="_blank" rel="noreferrer">{data.organization.website}</a><br />{/if}
						{#if data.organization.address}{data.organization.address}{/if}
					</div>
				{/if}
				{#if data.organization.businessRegistrationNumber || data.organization.taxId}
					<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
						{#if data.organization.businessRegistrationNumber}
							<Badge tone="grey" mono text="Reg. {data.organization.businessRegistrationNumber}" />
						{/if}
						{#if data.organization.taxId}
							<Badge tone="grey" mono text="Tax ID {data.organization.taxId}" />
						{/if}
					</div>
				{/if}
			</div>
			<div style="display:flex;gap:10px">
				<a href="/orgs/{data.organization._id}" class="btn btn-outline">Open dashboard</a>
				<button class="btn btn-outline" onclick={openEdit}>Edit details</button>
				<button class="btn btn-outline" style="border-color:var(--stamp-rust);color:var(--stamp-rust)" onclick={() => { errorMessage = null; confirmName = ''; deleteOpen = true; }}>Delete</button>
			</div>
		</div>

		<div>
			<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:14px">Analytics</div>
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
				<StatTicket label="Customers" value={data.analytics.customerCount.toLocaleString()} />
				<StatTicket label="Active members" value={data.analytics.activeMemberCount.toLocaleString()} />
				<StatTicket label="Points issued" value={data.analytics.pointsIssuedTotal.toLocaleString()} note="All time" />
				<StatTicket label="Coupons redeemed" value={`${data.analytics.couponsRedeemed} / ${data.analytics.couponsIssued}`} note="Redeemed / issued" />
				<StatTicket label="Rewards granted" value={data.analytics.rewardsGranted.toLocaleString()} />
			</div>
		</div>

		<div>
			<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:14px">Program setup</div>
			<div class="card" style="padding:4px 20px">
				{#each [
					{ label: 'Membership plans', count: data.analytics.planCount },
					{ label: 'Tiers', count: data.analytics.tierCount },
					{ label: 'Point rules', count: data.analytics.pointRuleCount },
					{ label: 'Rewards', count: data.analytics.rewardDefCount },
					{ label: 'Coupon types', count: data.analytics.couponDefCount }
				] as m (m.label)}
					<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid var(--line-2)">
						<div style="font:500 14px/1.3 'IBM Plex Sans',sans-serif;color:var(--ink)">{m.label}</div>
						<div class="mono" style="font:500 14px 'IBM Plex Mono',monospace;color:var(--ink)">{m.count}</div>
					</div>
				{/each}
			</div>
		</div>

		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:26px">
			<div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;margin-bottom:14px">Shops ({data.shops.length})</div>
				{#if data.shops.length === 0}
					<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">No shops yet.</div>
				{:else}
					<div class="card" style="padding:4px 18px">
						{#each data.shops as shop (shop._id)}
							<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;border-bottom:1px solid var(--line-2)">
								<div style="font:500 13px/1.3 'IBM Plex Sans',sans-serif;color:var(--ink)">{shop.name}</div>
								<div class="mono" style="font:400 12px 'IBM Plex Mono',monospace;color:var(--text-muted)">{shop.externalShopId ?? '—'}</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			<div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;margin-bottom:14px">Staff ({data.staff.length})</div>
				{#if data.staff.length === 0}
					<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">No staff yet.</div>
				{:else}
					<div class="card" style="padding:4px 18px">
						{#each data.staff as s (s.id)}
							<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 0;border-bottom:1px solid var(--line-2)">
								<div class="mono" style="font:400 13px 'IBM Plex Mono',monospace;color:var(--ink)">{s.email}</div>
								<Badge tone="grey" text={s.role} />
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<Drawer bind:open={editOpen} title="Edit organization details" note="These details help verify the business and set defaults for its shops.">
		<form id="edit-org-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Organization name</span>
					<input type="text" bind:value={name} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">Phone number</span>
					<input type="tel" bind:value={phoneNumber} class="input" />
				</label>
				<label class="field">
					<span class="field-label">Website (optional)</span>
					<input type="url" bind:value={website} class="input" />
				</label>
				<label class="field">
					<span class="field-label">Address</span>
					<input type="text" bind:value={address} class="input" />
				</label>
				<RegionCurrencyFields regions={regions.data ?? []} bind:regionId bind:currencyCode />
				<label class="field">
					<span class="field-label">Business registration number</span>
					<input type="text" bind:value={businessRegistrationNumber} class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Tax ID (GST / VAT / EIN)</span>
					<input type="text" bind:value={taxId} class="input mono" />
				</label>
			</div>
		</form>
		{#if errorMessage}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
			<button type="submit" form="edit-org-form" class="btn btn-accent" disabled={editSaving}>
				{#if editSaving}<span class="spinner"></span>Saving…{:else}Save details{/if}
			</button>
		{/snippet}
	</Drawer>

	<Drawer bind:open={deleteOpen} title="Delete organization" note="This permanently deletes the organization and everything under it — shops, customers, points, coupons, all of it. This cannot be undone.">
		<form id="delete-org-form" onsubmit={submitDelete}>
			<label class="field">
				<span class="field-label">Type <span class="mono" style="font-weight:600">{data.organization.name}</span> to confirm</span>
				<input type="text" bind:value={confirmName} class="input" autocomplete="off" />
			</label>
		</form>
		{#if errorMessage}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (deleteOpen = false)} disabled={deleteSaving}>Cancel</button>
			<button
				type="submit"
				form="delete-org-form"
				disabled={confirmName !== data.organization.name || deleteSaving}
				class="btn"
				style="background:var(--stamp-rust);color:#fff;opacity:{confirmName === data.organization.name && !deleteSaving ? 1 : 0.5}"
			>
				{#if deleteSaving}<span class="spinner"></span>Deleting…{:else}Delete organization{/if}
			</button>
		{/snippet}
	</Drawer>
{/if}
