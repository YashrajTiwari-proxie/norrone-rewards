<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		note,
		children,
		footer
	}: {
		open: boolean;
		title: string;
		note?: string;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	function close() {
		open = false;
	}
</script>

{#if open}
	<div class="drawer-overlay">
		<button
			aria-label="Close"
			onclick={close}
			style="flex:1;background:transparent;border:0;cursor:default"
		></button>
		<div class="drawer-panel">
			<div style="padding:22px 24px 18px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:12px;align-items:flex-start">
				<div>
					<div style="font:600 17px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink)">{title}</div>
					{#if note}
						<div style="margin-top:6px;font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
							{note}
						</div>
					{/if}
				</div>
				<button
					onclick={close}
					aria-label="Close drawer"
					style="background:transparent;border:0;color:var(--text-muted);font-size:18px;cursor:pointer;line-height:1;padding:2px"
				>
					×
				</button>
			</div>
			<div style="flex:1;overflow:auto;padding:22px 24px 28px;display:flex;flex-direction:column;gap:18px">
				{@render children()}
			</div>
			{#if footer}
				<div style="padding:16px 24px;border-top:1px solid var(--line);display:flex;gap:10px;justify-content:flex-end">
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
