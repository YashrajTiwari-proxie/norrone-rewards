<script lang="ts">
	let {
		name,
		level,
		color = 'var(--stamp-amber)',
		size = 62
	}: {
		name: string;
		level: number;
		color?: string;
		size?: number;
	} = $props();
</script>

<div
	class="stamp"
	style="width:{size}px;height:{size}px;flex:0 0 {size}px;border-color:{color};color:{color}"
>
	<div>
		<div class="stamp-title">{name}</div>
		<div class="stamp-sub">LVL {level}</div>
	</div>
</div>
