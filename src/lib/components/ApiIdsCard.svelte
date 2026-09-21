<script lang="ts">
	// Every /v1/... call needs a real shop ID in its path, and POST
	// .../membership needs a real plan ID in its body — neither was ever
	// visible anywhere in the dashboard, so an org had no way to actually
	// use the public API without a developer querying the database
	// directly. This card is the one place all of it is copyable at a
	// glance — shown on the API Keys page (where you'd naturally look for
	// "how do I call this"). The Overview page instead shows just the
	// org/shop id inline via IdLine directly, not this full dump.
	import IdLine from './IdLine.svelte';

	let {
		organizationId,
		shops,
		membershipPlans = []
	}: {
		organizationId: string;
		shops: { _id: string; name: string }[];
		membershipPlans?: { _id: string; name: string }[];
	} = $props();

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
			<IdLine label={r.label} id={r.id} />
		{/each}
	</div>
</div>
