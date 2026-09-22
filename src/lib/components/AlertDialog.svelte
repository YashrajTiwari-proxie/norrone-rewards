<script lang="ts">
	let {
		open = $bindable(false),
		title,
		body,
		confirmLabel = 'Confirm',
		confirming = false,
		onconfirm
	}: {
		open: boolean;
		title: string;
		body: string;
		confirmLabel?: string;
		confirming?: boolean;
		onconfirm: () => void;
	} = $props();

	function close() {
		if (!confirming) open = false;
	}
</script>

{#if open}
	<div class="dialog-overlay">
		<button aria-label="Close" onclick={close} style="position:fixed;inset:0;background:transparent;border:0;cursor:default"
		></button>
		<div class="dialog-panel" role="alertdialog" aria-modal="true">
			<div style="padding:22px 24px 6px">
				<div style="font:600 16px/1.3 'Plus Jakarta Sans',sans-serif;color:var(--ink)">{title}</div>
				<div style="margin-top:8px;font:400 13px/1.55 'Inter',sans-serif;color:var(--text-muted)">{body}</div>
			</div>
			<div style="padding:18px 24px 22px;display:flex;gap:10px;justify-content:flex-end">
				<button type="button" class="btn btn-ghost" onclick={close} disabled={confirming}>Cancel</button>
				<button type="button" class="btn btn-danger" onclick={onconfirm} disabled={confirming}>
					{#if confirming}<span class="spinner"></span>Working…{:else}{confirmLabel}{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
