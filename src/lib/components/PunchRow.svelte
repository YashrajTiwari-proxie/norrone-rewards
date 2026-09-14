<script lang="ts">
	let { filled, total }: { filled: number; total: number } = $props();
</script>

<div style="display:flex;align-items:center;gap:7px">
	{#each Array(total) as _, i (i)}
		<div class="punch-dot {i < filled ? 'punch-filled' : 'punch-empty'}"></div>
	{/each}
</div>
