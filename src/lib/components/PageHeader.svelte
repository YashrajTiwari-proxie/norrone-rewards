<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle,
		actions
	}: {
		title: string;
		subtitle?: string;
		actions?: Snippet;
	} = $props();
</script>

<div
	style="border-bottom:1px solid var(--line);background:var(--paper);padding:26px 40px 22px;display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap"
>
	<div style="min-width:0">
		<div style="font:600 24px/1.2 'IBM Plex Sans',sans-serif;letter-spacing:-.015em;color:var(--ink)">{title}</div>
		{#if subtitle}
			<div
				style="margin-top:6px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted);max-width:560px"
			>
				{subtitle}
			</div>
		{/if}
	</div>
	{#if actions}
		<div style="display:flex;align-items:center;gap:10px">
			{@render actions()}
		</div>
	{/if}
</div>
