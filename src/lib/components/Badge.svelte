<script lang="ts">
	let {
		tone = 'grey',
		mono = false,
		text
	}: {
		tone?: 'green' | 'amber' | 'rust' | 'grey';
		mono?: boolean;
		text: string;
	} = $props();
</script>

<span class="chip chip-{tone}" class:mono>{text}</span>
