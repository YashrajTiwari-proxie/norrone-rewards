<script lang="ts">
	import type { Snippet } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import { page } from '$app/state';
	import { useQuery, useAuth } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import type { Id } from '../../../../convex/_generated/dataModel';

	let { children }: { children: Snippet } = $props();

	const auth = getPlatformAuthContext();
	const convexAuth = useAuth();

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));

	let viewingShopId = $derived(page.url.searchParams.get('shop'));
</script>

{#if convexAuth.isLoading || org.isLoading}
	<div style="min-height:100vh;display:grid;place-items:center;font-family:'IBM Plex Sans',sans-serif">Loading…</div>
{:else if org.error}
	<div style="min-height:100vh;display:grid;place-items:center;font-family:'IBM Plex Sans',sans-serif">
		Failed to load organization: {org.error.message}
	</div>
{:else if !org.data}
	<div style="min-height:100vh;display:grid;place-items:center;font-family:'IBM Plex Sans',sans-serif;text-align:center">
		<div>
			<div style="font:600 18px 'IBM Plex Sans',sans-serif">Organization not found</div>
			<div style="margin-top:8px;color:var(--text-muted)">You are not staff at this organization, or it doesn't exist.</div>
			<div style="margin-top:16px"><a href="/">Back to your organizations</a></div>
		</div>
	</div>
{:else}
	<div style="display:flex;min-height:100vh;background:var(--paper);font-family:'IBM Plex Sans',sans-serif;color:var(--text)">
		<Sidebar
			orgId={organizationId}
			orgName={org.data.organization.name}
			shops={org.data.shops.map((s) => ({ id: s._id, name: s.name }))}
			{viewingShopId}
			staffName={auth.session.current?.user.email ?? ''}
			staffRole={org.data.myRole}
		/>
		<div style="flex:1;min-width:0;display:flex;flex-direction:column">
			<AppHeader orgId={organizationId} orgName={org.data.organization.name} />
			{@render children()}
		</div>
	</div>
{/if}
