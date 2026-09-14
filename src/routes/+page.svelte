<script lang="ts">
	import { useQuery } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { goto } from '$app/navigation';

	const auth = getPlatformAuthContext();
	const orgs = useQuery(api.organizations.myOrganizations, {});

	async function logOut() {
		await auth.authClient.signOut();
		await goto('/login');
	}
</script>

<div style="max-width:640px;margin:60px auto;padding:0 24px;font-family:'IBM Plex Sans',sans-serif">
	<h1>Your organizations</h1>

	{#if orgs.isLoading}
		<p>Loading…</p>
	{:else if orgs.error}
		<p>Failed to load organizations: {orgs.error.message}</p>
	{:else if orgs.data.length === 0}
		<p>No organizations yet — ask an owner to add you as staff, or <a href="/signup">create one</a>.</p>
	{:else}
		<ul>
			{#each orgs.data as org (org._id)}
				<li><a href="/orgs/{org._id}">{org.name}</a> <span style="color:var(--text-muted)">({org.role})</span></li>
			{/each}
		</ul>
	{/if}

	<button type="button" class="btn" onclick={logOut}>Log out</button>
</div>
