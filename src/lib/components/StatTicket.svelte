<script lang="ts">
	let {
		label,
		value,
		note,
		big = false
	}: {
		label: string;
		value: string;
		note?: string;
		big?: boolean;
	} = $props();
</script>

<div class="card" style="padding:18px 18px 16px;display:flex;flex-direction:column;gap:10px">
	<div
		style="font:500 10px/1 'IBM Plex Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)"
	>
		{label}
	</div>
	<div class="mono" style="font:500 {big ? 32 : 30}px/1 'IBM Plex Mono',monospace;letter-spacing:-.02em;color:var(--ink)">
		{value}
	</div>
	{#if note}
		<div style="font:400 12px/1.4 'IBM Plex Sans',sans-serif;color:var(--text-muted)">{note}</div>
	{/if}
</div>
