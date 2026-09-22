<script lang="ts">
	import '$lib/styles/tokens.css';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { goto } from '$app/navigation';

	const auth = getPlatformAuthContext();

	let email = $state('');
	let password = $state('');
	let signingIn = $state(false);
	let errorMessage = $state<string | null>(null);

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
		await goto('/');
	}
</script>

<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family: 'Inter', sans-serif">
	<div style="width:100%;max-width:392px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px">
			<img src="/norrone_rewards.svg" alt="Norrone Rewards" style="width:26px;height:26px;border-radius:6px" />
			<div style="font:600 15px/1 'Plus Jakarta Sans',sans-serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
		</div>
		<div class="card" style="padding:32px">
			<div style="font:600 21px/1.2 'Plus Jakarta Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">Sign in</div>
			<div style="margin-top:8px;font:400 14px/1.5 'Inter',sans-serif;color:var(--text-muted)">
				Staff access to your rewards program.
			</div>
			<form onsubmit={signIn} style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
				<label class="field">
					<span class="field-label">Work email</span>
					<input type="email" bind:value={email} placeholder="you@restaurant.com" required class="input" />
				</label>
				<label class="field">
					<span class="field-label">Password</span>
					<input type="password" bind:value={password} placeholder="••••••••••" required class="input mono" />
				</label>
				<button type="submit" class="btn btn-primary" style="width:100%;height:40px" disabled={signingIn}>
					{#if signingIn}<span class="spinner"></span>Signing in…{:else}Sign in{/if}
				</button>
			</form>
			{#if errorMessage}
				<div style="margin-top:14px;font:400 13px 'Inter',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
			{/if}
			<div style="margin-top:18px;text-align:center;font:400 13px 'Inter',sans-serif">
				<a href="/forgot-password">Forgot your password?</a>
			</div>
		</div>
		<div style="margin-top:20px;font:400 12px/1.6 'Inter',sans-serif;color:var(--text-muted);text-align:center">
			Access is granted by an owner or manager at your organization.<br />
			New to Norrone Rewards? <a href="/signup">Set up your organization</a>.
		</div>
	</div>
</div>
