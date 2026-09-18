<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import ApiIdsCard from '$lib/components/ApiIdsCard.svelte';
	import { page } from '$app/state';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	const keys = useQuery(api.apiKeys.list, () => ({ organizationId }));
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));
	const plans = useQuery(api.membershipPlans.list, () => ({ organizationId }));

	const createKey = useMutation(api.apiKeys.create);
	const revokeKey = useMutation(api.apiKeys.revoke);

	let addOpen = $state(false);
	let addSaving = $state(false);
	let errorMessage = $state<string | null>(null);
	let newKey = $state<string | null>(null);
	let keyDismissed = $state(false);
	let copied = $state(false);

	let type = $state<'secret' | 'publishable'>('secret');
	let shopId = $state('');

	function copyKey() {
		if (newKey) {
			navigator.clipboard.writeText(newKey);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		}
	}

	async function submitCreate(event: SubmitEvent) {
		event.preventDefault();
		addSaving = true;
		errorMessage = null;
		try {
			const result = await createKey({ organizationId, type, shopId: (shopId || undefined) as Id<'shops'> | undefined });
			newKey = result.plaintextKey;
			keyDismissed = false;
			addOpen = false;
		} catch {
			errorMessage = 'Failed to create API key.';
		} finally {
			addSaving = false;
		}
	}

	async function revoke(apiKeyId: Id<'apiKeys'>) {
		try {
			await revokeKey({ organizationId, apiKeyId });
		} catch {
			errorMessage = 'Failed to revoke API key.';
		}
	}
</script>

<PageHeader title="API Keys" subtitle="Machine credentials for your website or POS to call the rewards API.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={() => (addOpen = true)}>Generate a key</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:26px">
	{#if org.data}
		<ApiIdsCard {organizationId} shops={org.data.shops} membershipPlans={plans.data ?? []} />
	{/if}

	{#if newKey && !keyDismissed}
		<div style="background:var(--ink);border-radius:12px;padding:26px 28px">
			<div style="display:flex;align-items:center;gap:10px">
				<div style="width:8px;height:8px;border-radius:50%;background:var(--stamp-rust)"></div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--paper)">Copy this key now</div>
			</div>
			<div style="margin-top:10px;font:400 13px/1.6 'IBM Plex Sans',sans-serif;color:#A9B2BC;max-width:560px">
				This is the only time the key will be shown. Once you close this box we keep only a scrambled copy, so we
				can't show it to you again. If it's lost, revoke it and make a new one.
			</div>
			<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
				<div
					class="mono"
					style="flex:1;min-width:280px;background:#111923;border:1px solid var(--ink-3);border-radius:12px;padding:13px 15px;font:500 14px/1 'IBM Plex Mono',monospace;color:var(--paper);overflow:auto;white-space:nowrap"
				>
					{newKey}
				</div>
				<button
					onclick={copyKey}
					style="background:var(--paper);color:var(--ink);border:0;border-radius:9px;padding:12px 16px;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer"
				>
					{copied ? 'Copied!' : 'Copy key'}
				</button>
				<button
					onclick={() => (keyDismissed = true)}
					style="background:transparent;color:#C6CCD3;border:1px solid var(--ink-3);border-radius:9px;padding:12px 16px;font:500 13px 'IBM Plex Sans',sans-serif;cursor:pointer"
				>
					I've saved it
				</button>
			</div>
		</div>
	{/if}

	{#if keys.isLoading}
		<p>Loading…</p>
	{:else if keys.error}
		<p>Failed to load API keys: {keys.error.message}</p>
	{:else if keys.data.length === 0}
		<EmptyState title="No API keys yet" body="Generate a secret key for your backend, or a publishable key for client-side code, to start calling the rewards API.">
			{#snippet action()}
				<button class="btn btn-accent" onclick={() => (addOpen = true)}>Generate a key</button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="card" style="padding:6px 20px 14px">
			<table>
				<thead>
					<tr>
						<th>Type</th>
						<th>Works for</th>
						<th class="right">Created</th>
						<th class="right"></th>
					</tr>
				</thead>
				<tbody>
					{#each keys.data as key (key.id)}
						<tr>
							<td>
								<Chip tone={key.type === 'secret' ? 'rust' : 'green'} text={key.type} />
							</td>
							<td style="color:var(--text-muted)">{key.scopeName}</td>
							<td class="right mono" style="color:var(--text-muted)">{new Date(key.createdAt).toLocaleDateString()}</td>
							<td class="right">
								{#if key.revoked}
									<span style="font:500 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">Revoked</span>
								{:else}
									<button type="button" class="btn-danger-text" onclick={() => revoke(key.id)}>Revoke</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	{#if errorMessage}
		<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
</div>

<Drawer bind:open={addOpen} title="Generate a key" note="Choose a type and what it can access.">
	<form id="add-key-form" onsubmit={submitCreate}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Type</span>
				<select bind:value={type} class="input">
					<option value="secret">Secret — full read/write, server-side only</option>
					<option value="publishable">Publishable — read-only, safe client-side</option>
				</select>
			</label>
			<label class="field">
				<span class="field-label">Works for</span>
				<select bind:value={shopId} class="input">
					<option value="">All shops</option>
					{#each org.data?.shops ?? [] as shop (shop._id)}
						<option value={shop._id}>{shop.name}</option>
					{/each}
				</select>
			</label>
		</div>
	</form>
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={addSaving}>Cancel</button>
		<button type="submit" form="add-key-form" class="btn btn-accent" disabled={addSaving}>
			{#if addSaving}<span class="spinner"></span>Generating…{:else}Generate{/if}
		</button>
	{/snippet}
</Drawer>
