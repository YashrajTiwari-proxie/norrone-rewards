<script lang="ts">
	import '$lib/styles/tokens.css';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const auth = getPlatformAuthContext();

	// Better Auth's own GET /reset-password/:token callback (see
	// convex/auth.ts's sendResetPassword comment) redirects here with the
	// verified token attached as ?token=... — this page never sees the raw
	// token from the email link directly.
	let token = $derived(page.url.searchParams.get('token') ?? '');
	let error = $derived(page.url.searchParams.get('error'));

	let password = $state('');
	let confirmPassword = $state('');
	let submitting = $state(false);
	let done = $state(false);
	let errorMessage = $state<string | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = null;

		if (password.length < 8) {
			errorMessage = 'Password must be at least 8 characters.';
			return;
		}
		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
			return;
		}

		submitting = true;
		const { error: resetError } = await auth.authClient.resetPassword({ newPassword: password, token });
		submitting = false;
		if (resetError) {
			errorMessage = 'That reset link is invalid or has expired. Request a new one.';
			return;
		}
		done = true;
		setTimeout(() => goto('/login'), 2000);
	}
</script>

<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family: 'Inter', sans-serif">
	<div style="width:100%;max-width:392px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px">
			<img src="/norrone_rewards.svg" alt="Norrone Rewards" style="width:26px;height:26px;border-radius:6px" />
			<div style="font:600 15px/1 'Plus Jakarta Sans',sans-serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
		</div>
		<div class="card" style="padding:32px">
			{#if done}
				<div style="font:600 21px/1.2 'Plus Jakarta Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
					Password updated
				</div>
				<div style="margin-top:12px;font:400 14px/1.5 'Inter',sans-serif;color:var(--text-muted)">
					Taking you to sign in…
				</div>
			{:else if error || !token}
				<div style="font:600 21px/1.2 'Plus Jakarta Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
					Link invalid or expired
				</div>
				<div style="margin-top:12px;font:400 14px/1.5 'Inter',sans-serif;color:var(--text-muted)">
					This password reset link is no longer valid.
				</div>
				<div style="margin-top:18px;text-align:center;font:400 13px 'Inter',sans-serif">
					<a href="/forgot-password">Request a new link</a>
				</div>
			{:else}
				<div style="font:600 21px/1.2 'Plus Jakarta Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
					Set a new password
				</div>
				<form onsubmit={submit} style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
					<label class="field">
						<span class="field-label">New password</span>
						<input type="password" bind:value={password} required minlength="8" class="input mono" />
						<span style="margin-top:5px;font:400 12px 'Inter',sans-serif;color:var(--text-muted)">At least 8 characters.</span>
					</label>
					<label class="field">
						<span class="field-label">Confirm new password</span>
						<input type="password" bind:value={confirmPassword} required minlength="8" class="input mono" />
					</label>
					<button type="submit" class="btn btn-primary" style="width:100%;height:40px" disabled={submitting}>
						{#if submitting}<span class="spinner"></span>Updating…{:else}Update password{/if}
					</button>
				</form>
				{#if errorMessage}
					<div style="margin-top:14px;font:400 13px 'Inter',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
