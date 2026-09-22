<script lang="ts">
	import Icon from './Icon.svelte';

	let {
		label,
		value,
		note,
		big = false,
		icon
	}: {
		label: string;
		value: string;
		note?: string;
		big?: boolean;
		icon?: string;
	} = $props();
</script>

<div class="card" style="padding:18px 18px 16px;display:flex;flex-direction:column;gap:10px">
	<div style="display:flex;align-items:center;gap:8px">
		{#if icon}
			<div
				style="width:26px;height:26px;border-radius:7px;background:var(--surface-soft);display:flex;align-items:center;justify-content:center;color:var(--text-muted);flex:none"
			>
				<Icon name={icon} size={14} />
			</div>
		{/if}
		<div
			style="font:500 10px/1 'Geist', sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)"
		>
			{label}
		</div>
	</div>
	<div class="mono" style="font:500 {big ? 32 : 30}px/1 'Geist Mono', monospace;letter-spacing:-.02em;color:var(--ink)">
		{value}
	</div>
	{#if note}
		<div style="font:400 12px/1.4 'Geist', sans-serif;color:var(--text-muted)">{note}</div>
	{/if}
</div>
