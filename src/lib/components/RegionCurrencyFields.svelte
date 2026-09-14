<script lang="ts">
	type Region = { _id: string; countryName: string; currencyCode: string };

	let {
		regions,
		regionId = $bindable(''),
		currencyCode = $bindable('')
	}: {
		regions: Region[];
		regionId?: string;
		currencyCode?: string;
	} = $props();

	function onRegionChange(e: Event) {
		const id = (e.currentTarget as HTMLSelectElement).value;
		regionId = id;
		const region = regions.find((r) => r._id === id);
		if (region) currencyCode = region.currencyCode;
	}
</script>

<label class="field">
	<span class="field-label">Country</span>
	<select class="input" value={regionId} onchange={onRegionChange}>
		<option value="">Select a country</option>
		{#each regions as region (region._id)}
			<option value={region._id}>{region.countryName}</option>
		{/each}
	</select>
</label>
<label class="field">
	<span class="field-label">Currency code</span>
	<input
		type="text"
		bind:value={currencyCode}
		maxlength="3"
		class="input mono"
		placeholder="INR"
		style="text-transform:uppercase"
	/>
</label>
