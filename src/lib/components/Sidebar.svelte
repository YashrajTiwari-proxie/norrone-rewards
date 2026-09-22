<script lang="ts">
	import { page } from '$app/state';
	import { goto, afterNavigate } from '$app/navigation';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import Icon from './Icon.svelte';

	const auth = getPlatformAuthContext();

	async function signOut() {
		await auth.authClient.signOut();
		await goto('/login');
	}

	let {
		orgId,
		orgName,
		shops,
		viewingShopId,
		staffName,
		staffRole
	}: {
		orgId: string;
		orgName: string;
		shops: { id: string; name: string }[];
		viewingShopId: string | null;
		staffName: string;
		staffRole: string;
	} = $props();

	let programNav = $derived([
		{ id: 'overview', label: 'Overview', href: `/orgs/${orgId}`, icon: 'overview' },
		{ id: 'customers', label: 'Customers', href: `/orgs/${orgId}/customers`, icon: 'users' },
		{ id: 'membership', label: 'Membership', href: `/orgs/${orgId}/membership`, icon: 'card' },
		{ id: 'tiers', label: 'Tiers', href: `/orgs/${orgId}/tiers`, icon: 'layers' },
		{ id: 'points', label: 'Points', href: `/orgs/${orgId}/points`, icon: 'coin' },
		{ id: 'rewards', label: 'Rewards', href: `/orgs/${orgId}/rewards`, icon: 'gift' },
		{ id: 'coupons', label: 'Coupons', href: `/orgs/${orgId}/coupons`, icon: 'ticket' }
	]);

	let integrationNav = $derived([
		{ id: 'shops', label: 'Shops', href: `/orgs/${orgId}/shops`, icon: 'store' },
		{ id: 'api-keys', label: 'API Keys', href: `/orgs/${orgId}/api-keys`, icon: 'key' },
		{ id: 'wallet', label: 'Wallet Pass', href: `/orgs/${orgId}/wallet`, icon: 'wallet' },
		{ id: 'staff', label: 'Staff', href: `/orgs/${orgId}/staff`, icon: 'staff' }
	]);

	let docsNav = $derived([
		{ id: 'api-docs', label: 'API Docs', href: `/orgs/${orgId}/api-docs`, icon: 'book', external: false },
		{ id: 'api-demo', label: 'API Demo', href: '/api-demo', icon: 'search', external: true },
		{ id: 'wallet-demo', label: 'Wallet Demo', href: '/wallet-demo', icon: 'wallet', external: true }
	]);

	function isActive(id: string) {
		const path = page.url.pathname;
		const base = `/orgs/${orgId}`;
		if (id === 'overview') return path === base;
		return path.startsWith(`${base}/${id}`);
	}

	let switcherOpen = $state(false);
	let switcherEl: HTMLDivElement | undefined = $state();

	function pickShop(id: string | null) {
		const url = new URL(page.url);
		if (id) url.searchParams.set('shop', id);
		else url.searchParams.delete('shop');
		switcherOpen = false;
		goto(url.pathname + url.search, { keepFocus: true, noScroll: true });
	}

	function handleWindowClick(event: MouseEvent) {
		if (switcherOpen && switcherEl && !switcherEl.contains(event.target as Node)) {
			switcherOpen = false;
		}
	}

	// Belt-and-suspenders: also close on any route change, so a stray click
	// that lands on a nav link underneath the open dropdown can't be
	// swallowed by it.
	afterNavigate(() => {
		switcherOpen = false;
	});

	let viewingShopName = $derived(
		viewingShopId ? (shops.find((s) => s.id === viewingShopId)?.name ?? 'Unknown shop') : 'All shops'
	);

	const COLLAPSE_KEY = 'sidebar-collapsed';
	let collapsed = $state(false);
	$effect(() => {
		try {
			collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
		} catch {
			// localStorage unavailable (private mode, etc.) — default expanded.
		}
	});
	function toggleCollapsed() {
		collapsed = !collapsed;
		try {
			localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
		} catch {
			// best-effort persistence only
		}
	}
</script>

<svelte:window onclick={handleWindowClick} />

<div
	style="width:{collapsed
		? '68px'
		: '248px'};flex:0 0 {collapsed
		? '68px'
		: '248px'};background:var(--ink);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;overflow-x:hidden;align-self:flex-start;transition:width .15s ease,flex-basis .15s ease"
>
	<div style="padding:22px 18px 18px;{collapsed ? 'padding-left:16px;padding-right:16px' : ''}">
		<div style="display:flex;align-items:center;gap:9px;justify-content:{collapsed ? 'center' : 'space-between'}">
			<div style="display:flex;align-items:center;gap:9px;min-width:0">
				<div style="width:22px;height:22px;background:var(--paper);border-radius:3px;flex:none"></div>
				{#if !collapsed}
					<div
						style="font:600 14px/1 'Inter',sans-serif;color:var(--paper);letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
					>
						{orgName}
					</div>
				{/if}
			</div>
			{#if !collapsed}
				<button
					type="button"
					onclick={toggleCollapsed}
					title="Collapse sidebar"
					style="width:22px;height:22px;border-radius:6px;background:transparent;border:0;color:var(--ink-4);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none"
				>
					<Icon name="chevronLeft" size={13} />
				</button>
			{/if}
		</div>
		{#if collapsed}
			<button
				type="button"
				onclick={toggleCollapsed}
				title="Expand sidebar"
				style="margin-top:10px;width:100%;height:22px;border-radius:6px;background:transparent;border:0;color:var(--ink-4);cursor:pointer;display:flex;align-items:center;justify-content:center"
			>
				<Icon name="chevronRight" size={13} />
			</button>
		{/if}

		{#if !collapsed}
			<div style="margin-top:16px;position:relative" bind:this={switcherEl}>
				<button
					onclick={() => (switcherOpen = !switcherOpen)}
					style="width:100%;background:var(--ink-2);border:0;border-radius:12px;padding:9px 11px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;text-align:left"
				>
					<div>
						<div
							style="font:500 9px/1 'Inter',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)"
						>
							Viewing shop
						</div>
						<div style="margin-top:5px;font:500 13px/1 'Inter',sans-serif;color:var(--paper)">
							{viewingShopName}
						</div>
					</div>
					<div style="color:var(--ink-4)"><Icon name="chevronDown" size={13} /></div>
				</button>
				{#if switcherOpen}
					<div
						style="position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(27,36,48,.18);z-index:10;overflow:hidden"
					>
						<button
							onclick={() => pickShop(null)}
							style="width:100%;text-align:left;padding:9px 12px;background:transparent;border:0;cursor:pointer;font:500 13px 'Inter',sans-serif;color:var(--ink)"
						>
							All shops
						</button>
						{#each shops as shop (shop.id)}
							<button
								onclick={() => pickShop(shop.id)}
								style="width:100%;text-align:left;padding:9px 12px;background:transparent;border:0;border-top:1px solid var(--line-2);cursor:pointer;font:500 13px 'Inter',sans-serif;color:var(--ink)"
							>
								{shop.name}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<div style="padding:6px 10px 0">
		{#if !collapsed}
			<div
				style="padding:12px 8px 8px;font:500 9px/1 'Inter',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-4)"
			>
				Program
			</div>
		{/if}
		<div style="display:flex;flex-direction:column;gap:1px">
			{#each programNav as n (n.id)}
				<a
					href={n.href}
					title={collapsed ? n.label : undefined}
					style="display:flex;align-items:center;gap:10px;justify-content:{collapsed
						? 'center'
						: 'flex-start'};padding:9px 10px;border-radius:8px;text-decoration:none;font:500 13px 'Inter',sans-serif;color:{isActive(
						n.id
					)
						? 'var(--paper)'
						: '#C6CCD3'};background:{isActive(n.id) ? 'var(--ink-2)' : 'transparent'}"
				>
					<Icon name={n.icon} size={15} />
					{#if !collapsed}<span>{n.label}</span>{/if}
				</a>
			{/each}
		</div>
		{#if !collapsed}
			<div
				style="padding:20px 8px 8px;font:500 9px/1 'Inter',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-4)"
			>
				Integration
			</div>
		{:else}
			<div style="height:14px"></div>
		{/if}
		<div style="display:flex;flex-direction:column;gap:1px">
			{#each integrationNav as n (n.id)}
				<a
					href={n.href}
					title={collapsed ? n.label : undefined}
					style="display:flex;align-items:center;gap:10px;justify-content:{collapsed
						? 'center'
						: 'flex-start'};padding:9px 10px;border-radius:8px;text-decoration:none;font:500 13px 'Inter',sans-serif;color:{isActive(
						n.id
					)
						? 'var(--paper)'
						: '#C6CCD3'};background:{isActive(n.id) ? 'var(--ink-2)' : 'transparent'}"
				>
					<Icon name={n.icon} size={15} />
					{#if !collapsed}<span>{n.label}</span>{/if}
				</a>
			{/each}
		</div>
		{#if !collapsed}
			<div
				style="padding:20px 8px 8px;font:500 9px/1 'Inter',sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-4)"
			>
				Docs
			</div>
		{:else}
			<div style="height:14px"></div>
		{/if}
		<div style="display:flex;flex-direction:column;gap:1px">
			{#each docsNav as n (n.id)}
				<a
					href={n.href}
					target={n.external ? '_blank' : undefined}
					rel={n.external ? 'noopener' : undefined}
					title={collapsed ? n.label : undefined}
					style="display:flex;align-items:center;gap:10px;justify-content:{collapsed
						? 'center'
						: 'flex-start'};padding:9px 10px;border-radius:8px;text-decoration:none;font:500 13px 'Inter',sans-serif;color:{isActive(
						n.id
					)
						? 'var(--paper)'
						: '#C6CCD3'};background:{isActive(n.id) ? 'var(--ink-2)' : 'transparent'}"
				>
					<Icon name={n.icon} size={15} />
					{#if !collapsed}<span style="flex:1">{n.label}</span>{/if}
					{#if !collapsed && n.external}<Icon name="chevronRight" size={11} />{/if}
				</a>
			{/each}
		</div>
	</div>

	<div style="margin-top:auto;padding:16px {collapsed ? '10px' : '18px'};border-top:1px solid var(--ink-2)">
		{#if !collapsed}
			<div
				style="font:500 9px/1 'Inter',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)"
			>
				Signed in as
			</div>
			<div style="margin-top:6px;font:500 13px/1.3 'Inter',sans-serif;color:var(--paper);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
				{staffName}
			</div>
			<div style="margin-top:2px;font:400 12px/1.3 'Inter',sans-serif;color:var(--ink-4)">{staffRole}</div>
			<button
				type="button"
				onclick={signOut}
				style="margin-top:12px;background:transparent;border:1px solid var(--ink-3);color:#C6CCD3;border-radius:9px;padding:6px 11px;font:500 12px 'Inter',sans-serif;cursor:pointer;width:100%"
			>
				Sign out
			</button>
		{:else}
			<button
				type="button"
				onclick={signOut}
				title="Sign out ({staffName})"
				style="background:transparent;border:1px solid var(--ink-3);color:#C6CCD3;border-radius:9px;padding:7px;cursor:pointer;width:100%;display:flex;align-items:center;justify-content:center"
			>
				<Icon name="logout" size={14} />
			</button>
		{/if}
	</div>
</div>
