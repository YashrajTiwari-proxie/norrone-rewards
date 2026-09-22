<script lang="ts">
	let { label = 'Loading…' }: { label?: string } = $props();
</script>

<div style="display:flex;align-items:center;gap:10px;padding:40px 4px;color:var(--text-muted)">
	<span class="spinner"></span>
	<span style="font:400 13px 'Inter',sans-serif">{label}</span>
</div>
