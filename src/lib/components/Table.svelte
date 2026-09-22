<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="card" style="padding:6px 20px 14px">
	<table>
		{@render children()}
	</table>
</div>
