<script lang="ts">
	type Benefit = { _id: string; benefitType: string; pointsAmount?: number | null };

	let {
		benefits,
		onAdd,
		onRemove
	}: {
		benefits: Benefit[];
		onAdd: (input: { benefitType: 'POINTS'; pointsAmount: number }) => Promise<unknown>;
		onRemove: (benefitId: string) => Promise<unknown>;
	} = $props();

	let pointsAmount = $state('');
	let adding = $state(false);

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		const numericValue = Number(pointsAmount);
		if (!Number.isFinite(numericValue)) return;
		adding = true;
		try {
			await onAdd({ benefitType: 'POINTS', pointsAmount: numericValue });
			pointsAmount = '';
		} finally {
			adding = false;
		}
	}
</script>

<div style="border-top:1px solid var(--line-2);padding-top:18px">
	<div style="font:500 12px/1 'Inter',sans-serif">What they get</div>
	<div style="margin-top:5px;font:400 12px/1.4 'Inter',sans-serif;color:var(--text-muted)">
		Applied once, as soon as they qualify.
	</div>
	<div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
		{#each benefits as benefit (benefit._id)}
			<div
				style="background:var(--surface-soft);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px"
			>
				<div style="font:400 13px/1.4 'Inter',sans-serif;color:var(--ink)">
					{#if benefit.benefitType === 'POINTS'}
						<span class="mono" style="font-weight:500;color:var(--stamp-amber)">+{benefit.pointsAmount}</span> bonus
						points
					{:else}
						{benefit.benefitType}
					{/if}
				</div>
				<button type="button" class="btn-danger-text" onclick={() => onRemove(benefit._id)}>Remove</button>
			</div>
		{/each}
	</div>

	<form onsubmit={submitAdd} style="margin-top:10px">
		<div
			style="background:var(--surface-soft);border:1px solid var(--line);border-radius:12px;padding:10px;display:grid;grid-template-columns:130px 1fr;gap:8px"
		>
			<select class="input input-sm" disabled>
				<option value="POINTS">Bonus points</option>
			</select>
			<input type="number" bind:value={pointsAmount} step="any" required min="0" class="input input-sm mono" placeholder="Amount" />
			<button
				type="submit"
				disabled={adding}
				style="grid-column:1 / -1;background:transparent;border:1px dashed var(--dash);border-radius:9px;padding:9px 13px;width:100%;font:500 12px 'Inter',sans-serif;color:var(--ink);cursor:pointer"
			>
				+ Add a benefit
			</button>
		</div>
	</form>
</div>
