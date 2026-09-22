<script lang="ts">
	import '$lib/styles/tokens.css';
	import NavProgress from '$lib/components/NavProgress.svelte';
	import { createPlatformAuth } from '@proxie-studio/better-auth-tenant-kit';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import { setPlatformAuthContext } from '$lib/platformAuth';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const auth = createPlatformAuth({ convexUrl: PUBLIC_CONVEX_URL });
	setPlatformAuthContext(auth);
</script>

<svelte:head>
	<link rel="icon" href="/norrone_rewards.svg" />
</svelte:head>

<NavProgress />
{@render children()}
