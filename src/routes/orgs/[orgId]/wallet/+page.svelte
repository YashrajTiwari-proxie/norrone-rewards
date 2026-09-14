<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
</script>

<!--
	Wallet passes (Apple/Google) are paused pending real Apple/Google
	developer credentials — see the Convex migration's pending-tasks list.
	The old Supabase-era pass_templates/pass_registrations tables and
	their UI aren't ported; this is a placeholder so the nav link doesn't 500.
-->
<PageHeader title="Wallet Pass" subtitle="Apple and Google Wallet passes for your loyalty card and coupons." />

<div style="padding:34px 40px 72px;max-width:1260px">
	<EmptyState
		title="Wallet passes are paused"
		body="Apple/Google Wallet integration is on hold until real Apple and Google developer credentials are set up. Coupons and points still work everywhere else in the meantime."
	/>
</div>
