<script lang="ts">
	let {
		label,
		id,
		compact = false
	}: {
		label?: string;
		id: string;
		compact?: boolean;
	} = $props();

	let copied = $state(false);
	function copy() {
		navigator.clipboard.writeText(id);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

{#if compact}
	<div style="display:inline-flex;align-items:center;gap:6px">
		<code class="mono" style="font-size:11.5px;color:var(--text-muted)">{id}</code>
		<button
			type="button"
			onclick={copy}
			style="background:transparent;border:0;padding:0;cursor:pointer;font:500 11px 'Geist', sans-serif;color:var(--text-muted);text-decoration:underline"
		>
			{copied ? 'Copied!' : 'Copy'}
		</button>
	</div>
{:else}
	<div style="display:grid;grid-template-columns:{label ? '140px ' : ''}1fr auto;gap:10px;align-items:center">
		{#if label}
			<span style="font:500 12px 'Geist', sans-serif;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
				{label}
			</span>
		{/if}
		<code
			class="mono"
			style="background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12.5px;overflow-x:auto;white-space:nowrap"
		>
			{id}
		</code>
		<button type="button" class="btn btn-outline" style="padding:6px 12px;font-size:12px" onclick={copy}>
			{copied ? 'Copied!' : 'Copy'}
		</button>
	</div>
{/if}
