<script lang="ts">
	import { page } from '$app/state';

	let { orgId, orgName }: { orgId: string; orgName: string } = $props();

	const SEGMENT_LABELS: Record<string, string> = {
		customers: 'Customers',
		membership: 'Membership',
		tiers: 'Tiers',
		points: 'Points',
		rewards: 'Rewards',
		coupons: 'Coupons',
		shops: 'Shops',
		'api-keys': 'API Keys',
		'api-docs': 'API Docs',
		wallet: 'Wallet Pass',
		staff: 'Staff'
	};

	let crumbs = $derived.by(() => {
		const base = `/orgs/${orgId}`;
		const rest = page.url.pathname.startsWith(base) ? page.url.pathname.slice(base.length) : '';
		const segments = rest.split('/').filter(Boolean);
		const trail: { label: string; href: string }[] = [{ label: orgName, href: base }];
		let acc = base;
		for (const seg of segments) {
			acc += `/${seg}`;
			trail.push({ label: SEGMENT_LABELS[seg] ?? seg, href: acc });
		}
		return trail;
	});
</script>

<div
	style="position:sticky;top:0;z-index:20;background:var(--paper);border-bottom:1px solid var(--line);padding:0 40px;height:52px;display:flex;align-items:center;flex:none"
>
	<nav aria-label="Breadcrumb" style="display:flex;align-items:center;gap:6px;overflow:hidden">
		{#each crumbs as crumb, i (crumb.href)}
			{#if i > 0}
				<span style="color:var(--line-2);font:400 12px 'Inter',sans-serif">/</span>
			{/if}
			{#if i === crumbs.length - 1}
				<span
					style="font:500 12px 'Inter',sans-serif;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
				>
					{crumb.label}
				</span>
			{:else}
				<a
					href={crumb.href}
					style="font:400 12px 'Inter',sans-serif;color:var(--text-muted);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
				>
					{crumb.label}
				</a>
			{/if}
		{/each}
	</nav>
</div>
