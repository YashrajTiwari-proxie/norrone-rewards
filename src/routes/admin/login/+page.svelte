<script lang="ts">
	import '$lib/styles/tokens.css';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { useQuery, useAuth } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api';
	import { goto } from '$app/navigation';

	const auth = getPlatformAuthContext();
	const convexAuth = useAuth();
	const isAdmin = useQuery(api.platformAdmins.isCurrentUserAdmin, () =>
		convexAuth.isAuthenticated ? {} : 'skip'
	);

	$effect(() => {
		if (isAdmin.data === true) goto('/admin');
	});

	let email = $state('');
	let password = $state('');
	let signingIn = $state(false);
	let errorMessage = $state<string | null>(null);

	async function pollUntil(predicate: () => boolean, timeoutMs = 5000): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (predicate()) return true;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return false;
	}

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		signingIn = true;
		errorMessage = null;

		const { error } = await auth.authClient.signIn.email({ email, password });
		if (error) {
			errorMessage = 'Invalid email or password.';
			signingIn = false;
			return;
		}

		await auth.refreshSession();
		await pollUntil(() => convexAuth.isAuthenticated);
		// isCurrentUserAdmin is a live query, skipped until authenticated —
		// wait for it to actually settle (not still loading) before deciding.
		await pollUntil(() => !isAdmin.isLoading);

		if (isAdmin.data === true) {
			await goto('/admin');
		} else {
			await auth.authClient.signOut();
			errorMessage = 'This account does not have platform admin access.';
		}
		signingIn = false;
	}
</script>

<div style="min-height:100vh;background:var(--ink);display:grid;place-items:center;padding:40px;font-family: 'Inter', sans-serif">
	<div style="width:100%;max-width:392px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px;justify-content:center">
			<img src="/norrone_rewards.svg" alt="Norrone Rewards" style="width:26px;height:26px;border-radius:6px" />
			<div style="font:600 15px/1 'Plus Jakarta Sans',sans-serif;letter-spacing:-.01em;color:var(--paper)">
				Norrone Platform Admin
			</div>
		</div>
		<div style="background:var(--ink-2);border:1px solid var(--ink-3);border-radius:12px;padding:32px">
			<div style="font:600 21px/1.2 'Plus Jakarta Sans',sans-serif;color:var(--paper);letter-spacing:-.01em">
				Admin sign in
			</div>
			<div style="margin-top:8px;font:400 14px/1.5 'Inter',sans-serif;color:var(--ink-4)">
				For Norrone staff who manage organizations on the platform.
			</div>
			<form onsubmit={signIn} style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
				<label class="field">
					<span class="field-label" style="color:var(--paper)">Email</span>
					<input type="email" bind:value={email} required class="input" />
				</label>
				<label class="field">
					<span class="field-label" style="color:var(--paper)">Password</span>
					<input type="password" bind:value={password} required class="input mono" />
				</label>
				<button type="submit" class="btn btn-accent" style="width:100%;height:40px" disabled={signingIn}>
					{#if signingIn}<span class="spinner"></span>Signing in…{:else}Sign in{/if}
				</button>
			</form>
			{#if errorMessage}
				<div style="margin-top:14px;font:400 13px 'Inter',sans-serif;color:#F4A48A">{errorMessage}</div>
			{/if}
		</div>
		<div style="margin-top:20px;font:400 12px/1.6 'Inter',sans-serif;color:var(--ink-4);text-align:center">
			Looking for organization staff sign-in? <a href="/login" style="color:#C6CCD3">Go there instead</a>.
		</div>
	</div>
</div>
