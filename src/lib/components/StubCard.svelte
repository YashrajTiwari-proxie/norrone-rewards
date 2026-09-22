<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		subtitle,
		body,
		end,
		endWidth = 118
	}: {
		title: string;
		subtitle?: string;
		body?: Snippet;
		end: Snippet;
		endWidth?: number;
	} = $props();
</script>

<div class="stub">
	<div class="stub-body">
		<div>
			<div style="font:600 15px/1.3 'Plus Jakarta Sans',sans-serif;color:var(--ink)">{title}</div>
			{#if subtitle}
				<div class="mono" style="margin-top:6px;font:500 13px/1 'JetBrains Mono', monospace;letter-spacing:.04em;color:var(--text-muted)">
					{subtitle}
				</div>
			{/if}
		</div>
		{#if body}
			<div style="margin-top:14px">{@render body()}</div>
		{/if}
	</div>
	<div class="stub-perforation"></div>
	<div class="stub-end" style="width:{endWidth}px;flex:0 0 {endWidth}px">
		{@render end()}
	</div>
</div>
