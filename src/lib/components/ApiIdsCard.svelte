<script lang="ts">
	// Every /v1/... call needs a real shop ID in its path, and POST
	// .../membership needs a real plan ID in its body — neither was ever
	// visible anywhere in the dashboard, so an org had no way to actually
	// use the public API without a developer querying the database
	// directly. This card is the one place all of it is copyable at a
	// glance; shown on both the Overview page (first thing you see) and
	// the API Keys page (where you'd naturally look for "how do I call
	// this").
	let {
		organizationId,
		shops,
		membershipPlans = []
	}: {
		organizationId: string;
		shops: { _id: string; name: string }[];
		membershipPlans?: { _id: string; name: string }[];
	} = $props();

	let copiedId = $state<string | null>(null);
	function copyId(id: string) {
		navigator.clipboard.writeText(id);
		copiedId = id;
		setTimeout(() => (copiedId = null), 1500);
	}

	function row(label: string, id: string) {
		return { label, id };
	}
	let rows = $derived([
		row('Organization', organizationId),
		...shops.map((s) => row(s.name, s._id)),
		...membershipPlans.map((p) => row(`Plan: ${p.name}`, p._id))
	]);
</script>

<div class="card" style="padding:20px 22px;display:flex;flex-direction:column;gap:14px">
	<div>
		<div style="font:600 14px/1 'IBM Plex Sans',sans-serif">API reference IDs</div>
		<div style="margin-top:6px;font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			Every call is <code class="mono">/v1/shops/:shopId/...</code> — plan IDs are only needed for
			<code class="mono">POST .../membership</code>. Not shown anywhere else in the dashboard.
		</div>
	</div>
	<div style="display:flex;flex-direction:column;gap:8px">
		{#each rows as r (r.id)}
			<div style="display:grid;grid-template-columns:140px 1fr auto;gap:10px;align-items:center">
				<span style="font:500 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
					{r.label}
				</span>
				<code
					class="mono"
					style="background:var(--surface-soft);border:1px solid var(--line);border-radius:8px;padding:7px 10px;font-size:12.5px;overflow-x:auto;white-space:nowrap"
				>
					{r.id}
				</code>
				<button type="button" class="btn btn-outline" style="padding:6px 12px;font-size:12px" onclick={() => copyId(r.id)}>
					{copiedId === r.id ? 'Copied!' : 'Copy'}
				</button>
			</div>
		{/each}
	</div>
</div>
