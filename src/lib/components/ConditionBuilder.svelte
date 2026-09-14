<script lang="ts">
	type Condition = { _id: string; metric: string; operator: string; value: number; period: string };

	let {
		conditions,
		onAdd,
		onRemove
	}: {
		conditions: Condition[];
		onAdd: (input: { metric: string; operator: string; value: number; period: string }) => Promise<unknown>;
		onRemove: (conditionId: string) => Promise<unknown>;
	} = $props();

	const metricLabel: Record<string, string> = {
		SPEND: 'Total spend',
		VISITS: 'Visits',
		POINTS: 'Points balance',
		TIER_LEVEL: 'Tier level',
		MEMBERSHIP_ACTIVE: 'Active membership'
	};
	const operatorLabel: Record<string, string> = { GTE: 'is at least', LTE: 'is at most', EQ: 'is exactly' };
	const periodLabel: Record<string, string> = { LIFETIME: 'All time', MONTHLY: 'This month', YEARLY: 'This year' };

	let metric = $state('SPEND');
	let operator = $state('GTE');
	let value = $state('');
	let period = $state('LIFETIME');
	let adding = $state(false);

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		const numericValue = Number(value);
		if (!Number.isFinite(numericValue)) return;
		adding = true;
		try {
			await onAdd({ metric, operator, value: numericValue, period });
			value = '';
		} finally {
			adding = false;
		}
	}
</script>

<div style="border-top:1px solid var(--line-2);padding-top:18px">
	<div style="font:500 12px/1 'IBM Plex Sans',sans-serif">Who qualifies</div>
	<div style="margin-top:5px;font:400 12px/1.4 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
		All of these must be true.
	</div>
	<div style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
		{#each conditions as condition (condition._id)}
			<div
				style="background:var(--surface-soft);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px"
			>
				<div style="font:400 13px/1.4 'IBM Plex Sans',sans-serif;color:var(--ink)">
					{metricLabel[condition.metric] ?? condition.metric}
					{operatorLabel[condition.operator] ?? condition.operator}
					<span class="mono" style="font-weight:500">{condition.value}</span>
					<span style="color:var(--text-muted)">({periodLabel[condition.period] ?? condition.period})</span>
				</div>
				<button type="button" class="btn-danger-text" onclick={() => onRemove(condition._id)}>Remove</button>
			</div>
		{/each}
	</div>

	<form onsubmit={submitAdd} style="margin-top:10px">
		<div style="background:var(--surface-soft);border:1px solid var(--line);border-radius:12px;padding:10px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
			<select bind:value={metric} class="input input-sm">
				<option value="SPEND">Total spend</option>
				<option value="VISITS">Visits</option>
				<option value="POINTS">Points balance</option>
				<option value="TIER_LEVEL">Tier level</option>
				<option value="MEMBERSHIP_ACTIVE">Active membership</option>
			</select>
			<select bind:value={operator} class="input input-sm">
				<option value="GTE">is at least</option>
				<option value="LTE">is at most</option>
				<option value="EQ">is exactly</option>
			</select>
			<input type="number" bind:value step="any" required min="0" class="input input-sm mono" placeholder="Value" />
			<select bind:value={period} class="input input-sm">
				<option value="LIFETIME">All time</option>
				<option value="MONTHLY">This month</option>
				<option value="YEARLY">This year</option>
			</select>
			<button
				type="submit"
				disabled={adding}
				style="grid-column:1 / -1;background:transparent;border:1px dashed var(--dash);border-radius:9px;padding:9px 13px;width:100%;font:500 12px 'IBM Plex Sans',sans-serif;color:var(--ink);cursor:pointer"
			>
				+ Add a condition
			</button>
		</div>
	</form>
</div>
