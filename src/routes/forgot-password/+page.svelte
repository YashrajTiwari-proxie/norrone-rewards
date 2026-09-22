<script lang="ts">
	import '$lib/styles/tokens.css';
	import { getPlatformAuthContext } from '$lib/platformAuth';

	const auth = getPlatformAuthContext();

	let email = $state('');
	let submitting = $state(false);
	let sent = $state(false);
	let errorMessage = $state<string | null>(null);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		submitting = true;
		errorMessage = null;
		const { error } = await auth.authClient.requestPasswordReset({
			email: email.trim(),
			redirectTo: '/reset-password'
		});
		submitting = false;
		if (error) {
			errorMessage = 'Something went wrong. Please try again.';
			return;
		}
		// Better Auth always returns success here regardless of whether the
		// email exists, to avoid leaking account existence — so this message
		// is shown unconditionally once the request completes without error.
		sent = true;
	}
</script>

<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family:'IBM Plex Sans',sans-serif">
	<div style="width:100%;max-width:392px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px">
			<img src="/norrone_rewards.svg" alt="Norrone Rewards" style="width:26px;height:26px;border-radius:6px" />
			<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
		</div>
		<div class="card" style="padding:32px">
			{#if sent}
				<div style="font:600 21px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
					Check your email
				</div>
				<div style="margin-top:12px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					If an account exists for that email, we've sent a link to reset your password.
				</div>
			{:else}
				<div style="font:600 21px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
					Reset your password
				</div>
				<div style="margin-top:8px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					Enter your work email and we'll send you a link to reset it.
				</div>
				<form onsubmit={submit} style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
					<label class="field">
						<span class="field-label">Work email</span>
						<input type="email" bind:value={email} required class="input" />
					</label>
					<button type="submit" class="btn btn-primary" style="width:100%;height:40px" disabled={submitting}>
						{#if submitting}<span class="spinner"></span>Sending…{:else}Send reset link{/if}
					</button>
				</form>
				{#if errorMessage}
					<div style="margin-top:14px;font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
				{/if}
			{/if}
			<div style="margin-top:18px;text-align:center;font:400 13px 'IBM Plex Sans',sans-serif">
				<a href="/login">Back to sign in</a>
			</div>
		</div>
	</div>
</div>
