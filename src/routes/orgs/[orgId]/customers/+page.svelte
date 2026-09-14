<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	let shopId = $derived((page.url.searchParams.get('shop') as Id<'shops'> | null) ?? undefined);
	let search = $derived(page.url.searchParams.get('q')?.trim() ?? '');
	let tierFilter = $derived(page.url.searchParams.get('tier') ?? undefined);
	let pageNum = $derived(Math.max(1, Number(page.url.searchParams.get('page') ?? '1')));

	const customers = useQuery(api.customers.list, () => ({
		organizationId,
		shopId,
		search: search || undefined,
		tierFilter,
		page: pageNum
	}));

	let searchValue = $state(search);
	$effect(() => {
		searchValue = search;
	});

	function updateParam(key: string, value: string | null) {
		const url = new URL(page.url);
		if (value) url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		url.searchParams.delete('page');
		goto(url.pathname + url.search, { keepFocus: true });
	}

	function goToPage(p: number) {
		const url = new URL(page.url);
		url.searchParams.set('page', String(p));
		goto(url.pathname + url.search);
	}

	let totalPages = $derived(
		customers.data ? Math.max(1, Math.ceil(customers.data.totalCount / customers.data.pageSize)) : 1
	);
</script>

<PageHeader title="Customers" subtitle="Everyone enrolled in your rewards program." />

<div style="padding:34px 40px 72px;max-width:1260px">
	<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
		<input
			bind:value={searchValue}
			onkeydown={(e) => e.key === 'Enter' && updateParam('q', searchValue || null)}
			onblur={() => updateParam('q', searchValue || null)}
			placeholder="Search name or customer ID"
			class="input"
			style="flex:1;min-width:220px"
		/>
		<select
			class="input"
			style="width:auto"
			value={tierFilter ?? ''}
			onchange={(e) => updateParam('tier', (e.currentTarget as HTMLSelectElement).value || null)}
		>
			<option value="">All tiers</option>
			{#each customers.data?.tiers ?? [] as tier (tier.id)}
				<option value={tier.name}>{tier.name}</option>
			{/each}
		</select>
	</div>

	{#if customers.isLoading}
		<p>Loading…</p>
	{:else if customers.error}
		<p>Failed to load customers: {customers.error.message}</p>
	{:else if customers.data.customers.length === 0}
		<EmptyState title="No customers yet" body="Customers are created by your website or POS through the API — once they start signing people up, they'll show up here." />
	{:else}
		{@const data = customers.data}
		<div class="card" style="padding:6px 20px 10px">
			<table>
				<thead>
					<tr>
						<th>Customer</th>
						<th>Shop</th>
						<th>Tier</th>
						<th class="right">Points</th>
						<th>Membership</th>
						<th class="right">Last activity</th>
					</tr>
				</thead>
				<tbody>
					{#each data.customers as c (c.id)}
						<tr onclick={() => goto(`/orgs/${organizationId}/customers/${c.id}`)} style="cursor:pointer">
							<td>
								<div style="font:500 14px/1.3 'IBM Plex Sans',sans-serif;color:var(--ink)">{c.name}</div>
								<div class="mono" style="margin-top:3px;font:400 12px/1 'IBM Plex Mono',monospace;color:var(--text-muted)">{c.externalId}</div>
							</td>
							<td style="color:var(--text-muted)">{c.shopName}</td>
							<td>
								{#if c.tier}
									<Chip tone="grey" text={c.tier.name} />
								{:else}
									<span style="color:var(--text-muted)">—</span>
								{/if}
							</td>
							<td class="right mono" style="font-weight:500;color:var(--ink)">{c.points.toLocaleString()}</td>
							<td>
								{#if c.isMember}<Chip tone="green" text="Member" />{:else}<Chip tone="grey" text="Not a member" />{/if}
							</td>
							<td class="right mono" style="color:var(--text-muted)">{new Date(c.lastActivity).toLocaleDateString()}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 0 10px">
				<div style="font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					Showing <span class="mono">{(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.totalCount)}</span>
					of <span class="mono">{data.totalCount}</span>
				</div>
				<div style="display:flex;gap:8px">
					<button class="btn btn-ghost" disabled={data.page <= 1} onclick={() => goToPage(data.page - 1)}>Previous</button>
					<button class="btn btn-outline" disabled={data.page >= totalPages} onclick={() => goToPage(data.page + 1)}>Next</button>
				</div>
			</div>
		</div>
	{/if}
</div>
