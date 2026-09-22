<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		body,
		action
	}: {
		title: string;
		body: string;
		action?: Snippet;
	} = $props();
</script>

<div class="empty-state">
	<div class="empty-icon">
		<div style="width:20px;height:20px;border:1.5px solid var(--dash);border-radius:2px"></div>
	</div>
	<div style="margin-top:22px;font:600 18px/1.3 'Bodoni Moda', serif;color:var(--ink)">{title}</div>
	<div style="margin-top:9px;max-width:400px;font:400 14px/1.6 'Geist', sans-serif;color:var(--text-muted)">
		{body}
	</div>
	{#if action}
		<div style="margin-top:24px">{@render action()}</div>
	{/if}
</div>
