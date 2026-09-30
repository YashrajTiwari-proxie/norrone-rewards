<script lang="ts">
	import '$lib/styles/tokens.css';
	import { useQuery, useAuth } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { goto } from '$app/navigation';
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const auth = getPlatformAuthContext();
	const convexAuth = useAuth();
	const orgs = useQuery(api.organizations.myOrganizations, () => (convexAuth.isAuthenticated ? {} : 'skip'));

	// Unauthenticated visitors have nothing to pick from here — bounce to
	// login rather than showing an empty/broken picker.
	$effect(() => {
		if (!convexAuth.isLoading && !convexAuth.isAuthenticated) {
			goto('/login', { replaceState: true });
		}
	});

	async function logOut() {
		await auth.authClient.signOut();
		await goto('/login');
	}
</script>

<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family: 'Geist', sans-serif">
	<div style="width:100%;max-width:420px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px">
			<img src="/norrone_rewards.svg" alt="Norrone Rewards" style="width:26px;height:26px;border-radius:6px" />
			<div style="font:600 15px/1 'Bodoni Moda', serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
		</div>

		{#if convexAuth.isLoading || orgs.isLoading}
			<div class="card" style="padding:40px;display:grid;place-items:center"><PageLoading /></div>
		{:else if orgs.error}
			<div class="card" style="padding:32px">
				<div style="font:600 21px/1.2 'Bodoni Moda', serif;color:var(--ink);letter-spacing:-.01em">Couldn't load your organizations</div>
				<div style="margin-top:12px;font:400 14px/1.5 'Geist', sans-serif;color:var(--text-muted)">{orgs.error.message}</div>
			</div>
		{:else if orgs.data && orgs.data.length === 0}
			<div class="card" style="padding:32px">
				<div style="font:600 21px/1.2 'Bodoni Moda', serif;color:var(--ink);letter-spacing:-.01em">No organizations yet</div>
				<div style="margin-top:12px;font:400 14px/1.5 'Geist', sans-serif;color:var(--text-muted)">
					Ask an owner to add you as staff, or create one of your own.
				</div>
				<div style="margin-top:22px;display:flex;gap:10px">
					<a href="/signup" class="btn btn-primary" style="flex:1;text-align:center;text-decoration:none">Create organization</a>
					<button type="button" class="btn btn-outline" onclick={logOut}>Sign out</button>
				</div>
			</div>
		{:else if orgs.data}
			<div class="card" style="padding:10px">
				<div style="padding:14px 14px 10px;font:500 12px/1 'Geist', sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)">
					Your organizations
				</div>
				<div style="display:flex;flex-direction:column;gap:2px">
					{#each orgs.data as org (org._id)}
						<a
							href="/orgs/{org._id}/shops"
							style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:10px;text-decoration:none;color:var(--ink)"
							class="org-picker-row"
						>
							<span style="font:500 14px 'Geist', sans-serif">{org.name}</span>
							<span style="display:flex;align-items:center;gap:6px;font:400 12px 'Geist', sans-serif;color:var(--text-muted);text-transform:capitalize">
								{org.role}
								<Icon name="arrowRight" size={14} />
							</span>
						</a>
					{/each}
				</div>
				<div style="border-top:1px solid var(--line);margin-top:8px;padding:12px 14px 4px">
					<button type="button" class="btn btn-ghost" style="width:100%" onclick={logOut}>Sign out</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.org-picker-row:hover {
		background: var(--paper-2, #f4f1ec);
	}
</style>
