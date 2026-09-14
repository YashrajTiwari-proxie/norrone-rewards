<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import { useQuery } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { goto } from '$app/navigation';

	let { children }: { children: Snippet } = $props();

	const auth = getPlatformAuthContext();
	const isAdmin = useQuery(api.platformAdmins.isCurrentUserAdmin, {});

	let onOrgsList = $derived(page.url.pathname === '/admin');
	let onRegions = $derived(page.url.pathname.startsWith('/admin/regions'));

	async function signOut() {
		await auth.authClient.signOut();
		await goto('/admin/login');
	}
</script>

{#if isAdmin.isLoading}
	<div style="min-height:100vh;display:grid;place-items:center;font-family:'IBM Plex Sans',sans-serif">Loading…</div>
{:else if !isAdmin.data}
	<div style="min-height:100vh;display:grid;place-items:center;font-family:'IBM Plex Sans',sans-serif;text-align:center">
		<div>
			<div style="font:600 18px 'IBM Plex Sans',sans-serif">Not a platform admin</div>
			<div style="margin-top:8px;color:var(--text-muted)">This account doesn't have platform admin access.</div>
			<div style="margin-top:16px"><a href="/admin/login">Back to admin sign in</a></div>
		</div>
	</div>
{:else}
	<div style="display:flex;min-height:100vh;background:var(--paper);font-family:'IBM Plex Sans',sans-serif;color:var(--text)">
		<div
			style="width:248px;flex:0 0 248px;background:var(--ink);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;align-self:flex-start"
		>
			<div style="padding:22px 18px 18px">
				<div style="display:flex;align-items:center;gap:9px">
					<div style="width:22px;height:22px;background:var(--paper);border-radius:3px"></div>
					<div style="font:600 14px/1 'IBM Plex Sans',sans-serif;color:var(--paper);letter-spacing:-.01em">
						Platform Admin
					</div>
				</div>
			</div>

			<div style="padding:6px 10px 0">
				<a
					href="/admin"
					style="display:flex;align-items:center;padding:9px 10px;border-radius:8px;text-decoration:none;font:500 13px 'IBM Plex Sans',sans-serif;color:{onOrgsList
						? 'var(--paper)'
						: '#C6CCD3'};background:{onOrgsList ? 'var(--ink-2)' : 'transparent'}"
				>
					Organizations
				</a>
				<a
					href="/admin/regions"
					style="display:flex;align-items:center;padding:9px 10px;border-radius:8px;text-decoration:none;font:500 13px 'IBM Plex Sans',sans-serif;color:{onRegions
						? 'var(--paper)'
						: '#C6CCD3'};background:{onRegions ? 'var(--ink-2)' : 'transparent'}"
				>
					Regions
				</a>
			</div>

			<div style="margin-top:auto;padding:16px 18px;border-top:1px solid var(--ink-2)">
				<div
					style="font:500 9px/1 'IBM Plex Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-4)"
				>
					Signed in as
				</div>
				<div style="margin-top:6px;font:500 13px/1.3 'IBM Plex Sans',sans-serif;color:var(--paper)">
					{auth.session.current?.user.email ?? ''}
				</div>
				<button
					type="button"
					onclick={signOut}
					style="margin-top:12px;background:transparent;border:1px solid var(--ink-3);color:#C6CCD3;border-radius:9px;padding:6px 11px;font:500 12px 'IBM Plex Sans',sans-serif;cursor:pointer;width:100%"
				>
					Sign out
				</button>
			</div>
		</div>
		<div style="flex:1;min-width:0;display:flex;flex-direction:column">
			{@render children()}
		</div>
	</div>
{/if}
