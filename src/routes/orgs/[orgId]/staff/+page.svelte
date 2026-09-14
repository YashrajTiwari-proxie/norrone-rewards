<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation } from 'convex-svelte';
	import { ConvexError } from 'convex/values';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const staff = useQuery(api.staff.list, () => ({ organizationId }));
	const invite = useMutation(api.staff.invite);

	let email = $state('');
	let role = $state<'staff' | 'manager'>('staff');
	let inviting = $state(false);
	let errorMessage = $state<string | null>(null);
	let successMessage = $state<string | null>(null);

	async function submitInvite(event: SubmitEvent) {
		event.preventDefault();
		if (!email.trim()) {
			errorMessage = 'Email is required.';
			return;
		}
		inviting = true;
		errorMessage = null;
		successMessage = null;
		try {
			await invite({ organizationId, email: email.trim(), role });
			successMessage = 'Added to this organization.';
			email = '';
		} catch (err) {
			const data = err instanceof ConvexError ? (err.data as { code?: string; message?: string }) : null;
			errorMessage =
				data?.code === 'NO_ACCOUNT'
					? data.message!
					: 'Failed to add staff member.';
		} finally {
			inviting = false;
		}
	}
</script>

<PageHeader title="Staff" subtitle="Who has access to this organization's dashboard." />

<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:26px">
	<div class="card" style="padding:6px 20px 14px">
		<table>
			<thead>
				<tr>
					<th>Email</th>
					<th>Role</th>
					<th class="right">Status</th>
				</tr>
			</thead>
			<tbody>
				{#if staff.isLoading}
					<tr><td colspan="3">Loading…</td></tr>
				{:else if staff.error}
					<tr><td colspan="3">Failed to load staff: {staff.error.message}</td></tr>
				{:else}
					{#each staff.data as s (s.id)}
						<tr>
							<td class="mono" style="color:var(--text-muted)">{s.email}</td>
							<td style="color:var(--text-muted);text-transform:capitalize">{s.role}</td>
							<td class="right">
								<Chip tone={s.status === 'Active' ? 'green' : 'amber'} text={s.status} />
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<div class="card" style="padding:22px 24px;max-width:560px">
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif">Add someone</div>
		<div style="margin-top:7px;font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
			They need an existing account — self-serve invite emails aren't set up yet.
		</div>
		<form onsubmit={submitInvite} style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
			<input bind:value={email} type="email" placeholder="name@restaurant.com" required class="input" style="flex:1;min-width:200px" />
			<select bind:value={role} class="input" style="width:auto">
				<option value="staff">Staff</option>
				<option value="manager">Manager</option>
			</select>
			<button type="submit" class="btn btn-primary" disabled={inviting}>
				{#if inviting}<span class="spinner"></span>Adding…{:else}Add to organization{/if}
			</button>
		</form>
		{#if errorMessage}
			<div style="margin-top:10px;font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#if successMessage}
			<div style="margin-top:10px;font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-green)">{successMessage}</div>
		{/if}
	</div>
</div>
