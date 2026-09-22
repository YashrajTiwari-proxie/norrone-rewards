<script lang="ts">
	import { useQuery, useAuth } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { goto } from '$app/navigation';
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const auth = getPlatformAuthContext();
	const convexAuth = useAuth();
	const orgs = useQuery(api.organizations.myOrganizations, () => (convexAuth.isAuthenticated ? {} : 'skip'));

	// Staff belong to exactly one org in the common case — skip the picker
	// and land straight in their shops instead of an intermediate list.
	$effect(() => {
		if (orgs.data && orgs.data.length === 1) {
			goto(`/orgs/${orgs.data[0]._id}/shops`, { replaceState: true });
		}
	});

	async function logOut() {
		await auth.authClient.signOut();
		await goto('/login');
	}

	const features = [
		{ icon: 'layers', title: 'Tiers & membership', body: 'Reward loyalty with tiers and paid membership plans that unlock perks automatically.' },
		{ icon: 'coin', title: 'Points that just work', body: 'Grant and track points from any spend or visit event, with a full ledger per customer.' },
		{ icon: 'gift', title: 'Rewards & coupons', body: 'Set up qualifying conditions once — rewards and coupons issue themselves.' },
		{ icon: 'wallet', title: 'Apple & Google Wallet', body: 'Customers add a real wallet pass that updates live as their points and tier change.' },
		{ icon: 'book', title: 'A public API', body: 'Plug your website or POS straight in — every action available over a documented REST API.' },
		{ icon: 'store', title: 'Built for multi-shop', body: 'Run one program across every location, or scope plans and rewards to a single shop.' }
	];
</script>

{#if convexAuth.isLoading}
	<div style="min-height:100vh;display:grid;place-items:center"><PageLoading /></div>
{:else if convexAuth.isAuthenticated}
	<div style="max-width:640px;margin:60px auto;padding:0 24px;font-family:'IBM Plex Sans',sans-serif">
		{#if orgs.isLoading || (orgs.data && orgs.data.length === 1)}
			<PageLoading />
		{:else if orgs.error}
			<p>Failed to load organizations: {orgs.error.message}</p>
		{:else if orgs.data.length === 0}
			<p>No organizations yet — ask an owner to add you as staff, or <a href="/signup">create one</a>.</p>
		{:else}
			<h1>Your organizations</h1>
			<ul>
				{#each orgs.data as org (org._id)}
					<li><a href="/orgs/{org._id}/shops">{org.name}</a> <span style="color:var(--text-muted)">({org.role})</span></li>
				{/each}
			</ul>
			<button type="button" class="btn" onclick={logOut}>Log out</button>
		{/if}
	</div>
{:else}
	<div style="background:var(--paper);font-family:'IBM Plex Sans',sans-serif;color:var(--text)">
		<header style="border-bottom:1px solid var(--line);padding:18px 40px;display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:0 auto">
			<div style="display:flex;align-items:center;gap:10px">
				<div style="width:24px;height:24px;background:var(--ink);border-radius:4px"></div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
			</div>
			<div style="display:flex;align-items:center;gap:10px">
				<a href="/login" class="btn btn-ghost">Sign in</a>
				<a href="/signup" class="btn btn-primary">Get started</a>
			</div>
		</header>

		<section style="max-width:760px;margin:0 auto;padding:96px 40px 64px;text-align:center">
			<div style="font:600 44px/1.12 'IBM Plex Sans',sans-serif;letter-spacing:-.03em;color:var(--ink)">
				Loyalty programs your customers actually use
			</div>
			<div style="margin-top:18px;font:400 17px/1.6 'IBM Plex Sans',sans-serif;color:var(--text-muted);max-width:560px;margin-left:auto;margin-right:auto">
				Points, tiers, rewards, coupons, and real Apple &amp; Google Wallet passes — run across every shop, driven by
				a public API your website or POS can call directly.
			</div>
			<div style="margin-top:32px;display:flex;gap:12px;justify-content:center">
				<a href="/signup" class="btn btn-primary" style="padding:11px 22px">Set up your organization</a>
				<a href="/login" class="btn btn-outline" style="padding:11px 22px">Sign in</a>
			</div>
		</section>

		<section style="max-width:1120px;margin:0 auto;padding:0 40px 100px">
			<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px">
				{#each features as f (f.title)}
					<div class="card" style="padding:24px">
						<div
							style="width:34px;height:34px;border-radius:9px;background:var(--surface-soft);display:flex;align-items:center;justify-content:center;color:var(--ink)"
						>
							<Icon name={f.icon} size={17} />
						</div>
						<div style="margin-top:14px;font:600 15px/1.3 'IBM Plex Sans',sans-serif;color:var(--ink)">{f.title}</div>
						<div style="margin-top:6px;font:400 13.5px/1.55 'IBM Plex Sans',sans-serif;color:var(--text-muted)">{f.body}</div>
					</div>
				{/each}
			</div>
		</section>

		<footer style="border-top:1px solid var(--line);padding:22px 40px;text-align:center;font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			© {new Date().getFullYear()} Norrone Rewards
		</footer>
	</div>
{/if}
