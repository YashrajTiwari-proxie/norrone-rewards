<script lang="ts">
	import '$lib/styles/tokens.css';
	import { page } from '$app/state';
	import { useMutation } from 'convex-svelte';
	import { api } from '../../../../convex/_generated/api';

	let token = $derived(page.url.searchParams.get('token') ?? '');
	const unsubscribe = useMutation(api.newsletter.unsubscribeByToken);

	let state = $state<'idle' | 'working' | 'done' | 'invalid'>('idle');

	$effect(() => {
		if (state !== 'idle' || !token) return;
		state = 'working';
		unsubscribe({ token })
			.then((result) => {
				state = result.found ? 'done' : 'invalid';
			})
			.catch(() => {
				state = 'invalid';
			});
	});
</script>

<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family: 'Geist', sans-serif">
	<div style="width:100%;max-width:392px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px">
			<img src="/norrone_rewards.svg" alt="Norrone Rewards" style="width:26px;height:26px;border-radius:6px" />
			<div style="font:600 15px/1 'Bodoni Moda', serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
		</div>
		<div class="card" style="padding:32px">
			{#if !token || state === 'invalid'}
				<div style="font:600 21px/1.2 'Bodoni Moda', serif;color:var(--ink);letter-spacing:-.01em">
					Link invalid or expired
				</div>
				<div style="margin-top:12px;font:400 14px/1.5 'Geist', sans-serif;color:var(--text-muted)">
					This unsubscribe link is no longer valid.
				</div>
			{:else if state === 'working' || state === 'idle'}
				<div style="font:600 21px/1.2 'Bodoni Moda', serif;color:var(--ink);letter-spacing:-.01em">
					Unsubscribing…
				</div>
			{:else}
				<div style="font:600 21px/1.2 'Bodoni Moda', serif;color:var(--ink);letter-spacing:-.01em">
					You're unsubscribed
				</div>
				<div style="margin-top:12px;font:400 14px/1.5 'Geist', sans-serif;color:var(--text-muted)">
					You won't get any more emails from Norrone Rewards. If that was a mistake, you can always
					subscribe again from the homepage.
				</div>
			{/if}
			<div style="margin-top:18px;text-align:center;font:400 13px 'Geist', sans-serif">
				<a href="/">Back to Norrone Rewards</a>
			</div>
		</div>
	</div>
</div>
