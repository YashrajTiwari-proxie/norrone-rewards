<script lang="ts">
	import PageLoading from '$lib/components/PageLoading.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatTicket from '$lib/components/StatTicket.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IdLine from '$lib/components/IdLine.svelte';
	import { page } from '$app/state';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api';
	import type { Id } from '../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	let shopId = $derived((page.url.searchParams.get('shop') as Id<'shops'> | null) ?? undefined);
	const overview = useQuery(api.dashboard.getOverview, () => ({ organizationId, shopId }));

	const couponTones: Record<string, string> = {
		ISSUED: 'var(--stamp-green)',
		REDEEMED: 'var(--stamp-grey-bg)',
		EXPIRED: 'var(--stamp-rust)',
		CANCELLED: '#B9B7A9'
	};
	let couponTotal = $derived(
		overview.data ? Object.values(overview.data.couponStatusCounts).reduce((a, b) => a + b, 0) || 1 : 1
	);
</script>

<PageHeader title="Overview" subtitle="How your rewards program is doing right now." />

<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:26px">
	<div style="display:flex;flex-direction:column;gap:6px;max-width:620px">
		<IdLine label="Organization ID" id={organizationId} />
		{#if shopId}
			<IdLine label="Shop ID" id={shopId} />
		{/if}
	</div>
	{#if overview.isLoading}
		<PageLoading />
	{:else if overview.error}
		<p>Failed to load overview: {overview.error.message}</p>
	{:else if overview.data.stats.customerCount === 0}
		<EmptyState
			title="No customers yet"
			body="Once your website or POS starts creating customers through the API, their activity will show up here."
		/>
	{:else}
		{@const data = overview.data}
		<div style="display:flex;flex-direction:column;gap:38px">
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
				<StatTicket label="Customers" value={data.stats.customerCount.toLocaleString()} note="Total on file" />
				<StatTicket label="Active members" value={data.stats.activeMemberCount.toLocaleString()} note="Paid membership, not expired" />
				<StatTicket label="Points issued" value={data.stats.pointsIssuedTotal.toLocaleString()} note="Last 12 weeks" />
				<StatTicket label="Coupons redeemed" value={data.stats.couponsRedeemed.toLocaleString()} note="All time" />
			</div>

			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:16px">
				<div class="card" style="padding:22px 24px 18px">
					<div style="font:600 15px/1 'Bodoni Moda', serif;color:var(--ink)">Points issued</div>
					<div style="margin-top:6px;font:400 12px/1.4 'Geist', sans-serif;color:var(--text-muted)">Last 12 weeks</div>
					<div style="margin-top:24px;display:flex;align-items:flex-end;gap:8px;height:132px;border-bottom:1px solid var(--line);padding-bottom:2px">
						{#each data.weekBuckets as w, i (i)}
							<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%" title="{w.total} points">
								<div style="height:{Math.max(w.pct, 2)}%;background:var(--stamp-green);border-radius:2px 2px 0 0"></div>
							</div>
						{/each}
					</div>
				</div>

				<div class="card" style="padding:22px 24px 20px">
					<div style="font:600 15px/1 'Bodoni Moda', serif;color:var(--ink)">Where customers sit</div>
					<div style="margin-top:6px;font:400 12px/1.4 'Geist', sans-serif;color:var(--text-muted)">
						Share of {data.stats.customerCount.toLocaleString()} customers by tier
					</div>
					{#if data.tierDist.length === 0}
						<div style="margin-top:22px;font:400 13px 'Geist', sans-serif;color:var(--text-muted)">
							No customers hold a tier yet.
						</div>
					{:else}
						<div style="margin-top:22px;display:flex;flex-direction:column;gap:16px">
							{#each data.tierDist as t (t.name)}
								<div>
									<div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px">
										<span style="font:500 13px/1 'Geist', sans-serif;color:var(--ink)">{t.name}</span>
										<span class="mono" style="font:400 12px/1 'Geist Mono', monospace;color:var(--text-muted)">{t.count} · {t.pct}%</span>
									</div>
									<div style="margin-top:8px;height:10px;border-radius:6px;background:var(--stamp-grey-bg);overflow:hidden">
										<div style="height:100%;width:{t.pct}%;background:var(--stamp-amber)"></div>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>

			<div>
				<div style="font:600 15px/1 'Bodoni Moda', serif;color:var(--ink);margin-bottom:14px">Coupon outcomes</div>
				<div class="card" style="padding:22px 24px 20px">
					<div style="display:flex;height:14px;border-radius:8px;overflow:hidden;gap:2px">
						{#each Object.entries(data.couponStatusCounts) as [status, count] (status)}
							{#if count > 0}
								<div style="width:{(count / couponTotal) * 100}%;background:{couponTones[status]}"></div>
							{/if}
						{/each}
					</div>
					<div style="margin-top:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px">
						{#each Object.entries(data.couponStatusCounts) as [status, count] (status)}
							<div style="display:flex;align-items:flex-start;gap:9px">
								<div style="width:9px;height:9px;border-radius:50%;margin-top:4px;background:{couponTones[status]}"></div>
								<div>
									<div style="font:500 13px/1 'Geist', sans-serif;color:var(--ink)">{status}</div>
									<div class="mono" style="margin-top:6px;font:500 16px/1 'Geist Mono', monospace;color:var(--ink)">{count}</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			</div>

			{#if data.recentCoupons.length > 0}
				<div>
					<div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:14px">
						<div style="font:600 15px/1 'Bodoni Moda', serif;color:var(--ink)">Coupons in customers' hands</div>
						<a href="/orgs/{organizationId}/coupons">All coupons</a>
					</div>
					<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
						{#each data.recentCoupons as c, i (i)}
							<div class="stub">
								<div class="stub-body">
									<div>
										<div style="font:600 14px/1.3 'Geist', sans-serif;color:var(--ink)">{c.couponDefinition?.name}</div>
										<div class="mono" style="margin-top:6px;font:500 13px/1 'Geist Mono', monospace;letter-spacing:.04em;color:var(--text-muted)">{c.code}</div>
									</div>
									<span class="chip chip-green">Issued</span>
								</div>
								<div class="stub-perforation"></div>
								<div class="stub-end">
									<div style="text-align:center">
										<div class="mono" style="font:600 24px/1 'Geist Mono', monospace;color:var(--stamp-amber)">
											{c.couponDefinition?.discountType === 'PERCENTAGE'
												? `${c.couponDefinition?.discountValue}%`
												: `₹${c.couponDefinition?.discountValue}`}
										</div>
										<div style="margin-top:5px;font:500 9px/1 'Geist', sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)">off</div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<div>
				<div style="font:600 15px/1 'Bodoni Moda', serif;color:var(--ink);margin-bottom:14px">Program setup</div>
				<div class="card" style="padding:4px 20px">
					{#each data.modules as m (m.id)}
						<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 0;border-bottom:1px solid var(--line-2)">
							<div style="display:flex;align-items:center;gap:14px;min-width:0">
								<span style="width:8px;height:8px;border-radius:50%;background:{m.configured ? 'var(--stamp-green)' : 'var(--dash)'}"></span>
								<div>
									<div style="font:500 14px/1.3 'Geist', sans-serif;color:var(--ink)">{m.label}</div>
									<div style="margin-top:3px;font:400 12px/1.4 'Geist', sans-serif;color:var(--text-muted)">
										{m.configured ? 'Configured' : 'Not set up yet'}
									</div>
								</div>
							</div>
							<a href="/orgs/{organizationId}/{m.id}" class="btn btn-outline">Configure</a>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
