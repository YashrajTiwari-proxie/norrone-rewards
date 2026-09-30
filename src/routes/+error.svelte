<script lang="ts">
	import '$lib/styles/tokens.css';
	import { page } from '$app/state';

	// SvelteKit routes every unhandled error here — a missing route (404), a
	// thrown `error()` from a load function (403/400/etc.), or an
	// uncaught exception (500) — instead of its default unstyled page.
	// One place, branded like every other standalone page (login,
	// reset-password, unsubscribe), rather than each error type looking
	// different depending on where it was thrown from.
	let status = $derived(page.status);
	let message = $derived(page.error?.message ?? 'Something went wrong.');

	const copy: Record<number, { title: string; body: string }> = {
		404: {
			title: "Page not found",
			body: "The page you're looking for doesn't exist, or the link may be out of date."
		},
		401: {
			title: 'Sign in required',
			body: "You'll need to sign in to view this page."
		},
		403: {
			title: 'Access denied',
			body: "You don't have permission to view this page."
		},
		500: {
			title: 'Something went wrong',
			body: 'An unexpected error occurred on our end. Try again in a moment.'
		}
	};

	let known = $derived(copy[status]);
	let title = $derived(known?.title ?? `Error ${status}`);
	let body = $derived(known?.body ?? message);
</script>

<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family: 'Geist', sans-serif">
	<div style="width:100%;max-width:392px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px">
			<img src="/norrone_rewards.svg" alt="Norrone Rewards" style="width:26px;height:26px;border-radius:6px" />
			<div style="font:600 15px/1 'Bodoni Moda', serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
		</div>
		<div class="card" style="padding:32px">
			<div style="font:500 12px/1 'Geist', sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)">
				Error {status}
			</div>
			<div style="margin-top:8px;font:600 21px/1.2 'Bodoni Moda', serif;color:var(--ink);letter-spacing:-.01em">
				{title}
			</div>
			<div style="margin-top:12px;font:400 14px/1.5 'Geist', sans-serif;color:var(--text-muted)">
				{body}
			</div>
			<div style="margin-top:22px;display:flex;gap:10px">
				<a href="/" class="btn btn-outline" style="flex:1;text-align:center;text-decoration:none">Go home</a>
				<button type="button" class="btn btn-primary" style="flex:1" onclick={() => location.reload()}>Try again</button>
			</div>
		</div>
	</div>
</div>
