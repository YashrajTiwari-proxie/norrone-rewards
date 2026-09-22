<script lang="ts">
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Table from '$lib/components/Table.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import AlertDialog from '$lib/components/AlertDialog.svelte';
	import Badge from '$lib/components/Badge.svelte';
	import ConditionBuilder from '$lib/components/ConditionBuilder.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IdLine from '$lib/components/IdLine.svelte';
	import { useQuery, useMutation } from 'convex-svelte';
	import { api } from '../../../../../convex/_generated/api';
	import type { Id } from '../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	let statusFilter = $derived(page.url.searchParams.get('status') ?? undefined);
	let pageNum = $derived(Math.max(1, Number(page.url.searchParams.get('page') ?? '1')));

	const definitions = useQuery(api.coupons.listDefinitions, () => ({ organizationId }));
	const instances = useQuery(api.coupons.listInstances, () => ({
		organizationId,
		status: statusFilter as 'ISSUED' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED' | undefined,
		page: pageNum
	}));
	const org = useQuery(api.organizations.getForStaff, () => ({ organizationId }));

	const createDef = useMutation(api.coupons.create);
	const updateDef = useMutation(api.coupons.update);
	const removeDef = useMutation(api.coupons.remove);
	const addCondition = useMutation(api.coupons.addCondition);
	const removeCondition = useMutation(api.coupons.removeCondition);

	let addOpen = $state(false);
	let editOpen = $state(false);
	let editingDefId = $state<Id<'couponDefinitions'> | null>(null);
	// Derived, not a snapshot — see tiers/+page.svelte's identical comment.
	let editingDef = $derived(definitions.data?.find((d) => d._id === editingDefId) ?? null);
	let addSaving = $state(false);
	let editSaving = $state(false);
	let errorMessage = $state<string | null>(null);

	let name = $state('');
	let discountValue = $state('');
	let discountType = $state<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
	let validityDays = $state('');
	let memberOnly = $state(false);
	let shopId = $state('');

	function openAdd() {
		name = '';
		discountValue = '';
		discountType = 'PERCENTAGE';
		validityDays = '';
		memberOnly = false;
		shopId = '';
		errorMessage = null;
		addOpen = true;
	}

	function openEdit(def: NonNullable<typeof definitions.data>[number]) {
		editingDefId = def._id;
		name = def.name;
		discountValue = String(def.discountValue);
		discountType = def.discountType;
		validityDays = String(def.validityDays);
		memberOnly = def.memberOnly;
		shopId = def.shopId ?? '';
		errorMessage = null;
		editOpen = true;
	}

	async function submitAdd(event: SubmitEvent) {
		event.preventDefault();
		const value = Number(discountValue);
		const days = Number(validityDays);
		if (!name.trim() || !Number.isFinite(value) || !Number.isFinite(days)) {
			errorMessage = 'Name, discount value, and validity days are required.';
			return;
		}
		addSaving = true;
		errorMessage = null;
		try {
			await createDef({
				organizationId,
				name: name.trim(),
				discountValue: value,
				discountType,
				validityDays: days,
				memberOnly,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			addOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to create coupon.';
		} finally {
			addSaving = false;
		}
	}

	async function submitUpdate(event: SubmitEvent) {
		event.preventDefault();
		if (!editingDef) return;
		const value = Number(discountValue);
		const days = Number(validityDays);
		if (!name.trim() || !Number.isFinite(value) || !Number.isFinite(days)) {
			errorMessage = 'Name, discount value, and validity days are required.';
			return;
		}
		editSaving = true;
		errorMessage = null;
		try {
			await updateDef({
				organizationId,
				couponDefinitionId: editingDef._id,
				name: name.trim(),
				discountValue: value,
				discountType,
				validityDays: days,
				memberOnly,
				shopId: (shopId || undefined) as Id<'shops'> | undefined
			});
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to update coupon.';
		} finally {
			editSaving = false;
		}
	}

	let deleteConfirmOpen = $state(false);
	let deleting = $state(false);

	async function deleteDef() {
		if (!editingDef) return;
		deleting = true;
		try {
			await removeDef({ organizationId, couponDefinitionId: editingDef._id });
			deleteConfirmOpen = false;
			editOpen = false;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to delete coupon.';
		} finally {
			deleting = false;
		}
	}

	const statusTone: Record<string, 'green' | 'grey' | 'rust'> = {
		ISSUED: 'green',
		REDEEMED: 'grey',
		EXPIRED: 'rust',
		CANCELLED: 'grey'
	};

	function setStatusFilter(status: string | null) {
		const url = new URL(page.url);
		if (status) url.searchParams.set('status', status);
		else url.searchParams.delete('status');
		url.searchParams.delete('page');
		goto(url.pathname + url.search);
	}

	function goToPage(p: number) {
		const url = new URL(page.url);
		url.searchParams.set('page', String(p));
		goto(url.pathname + url.search);
	}

	let totalPages = $derived(
		instances.data ? Math.max(1, Math.ceil(instances.data.instanceCount / instances.data.pageSize)) : 1
	);
</script>

<PageHeader title="Coupons" subtitle="Discount codes customers redeem, and the ones already in their hands.">
	{#snippet actions()}
		<button class="btn btn-primary" onclick={openAdd}>Add a coupon type</button>
	{/snippet}
</PageHeader>

<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:38px">
	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:14px">Coupon types</div>
		{#if definitions.isLoading}
			<PageLoading />
		{:else if definitions.error}
			<p>Failed to load coupons: {definitions.error.message}</p>
		{:else if definitions.data.length === 0}
			<EmptyState title="No coupons yet" body="Create one to bring customers back for a specific offer.">
				{#snippet action()}
					<button class="btn btn-accent" onclick={openAdd}>Add a coupon type</button>
				{/snippet}
			</EmptyState>
		{:else}
			<Table>
					<thead>
						<tr>
							<th>Name</th>
							<th class="right">Discount</th>
							<th class="right">Validity</th>
							<th>Who qualifies</th>
							<th>Applies to</th>
						</tr>
					</thead>
					<tbody>
						{#each definitions.data as def (def._id)}
							<tr onclick={() => openEdit(def)} style="cursor:pointer">
								<td>
									<div style="font:500 14px 'IBM Plex Sans',sans-serif;color:var(--ink)">{def.name}</div>
									<div style="margin-top:3px" onclick={(e) => e.stopPropagation()} role="presentation">
										<IdLine id={def._id} compact />
									</div>
									{#if def.memberOnly}<div style="margin-top:4px"><Badge tone="amber" text="Members only" /></div>{/if}
								</td>
								<td class="right mono" style="font-weight:500;color:var(--stamp-amber)">
									{def.discountType === 'PERCENTAGE' ? `${def.discountValue}%` : `₹${def.discountValue}`}
								</td>
								<td class="right mono" style="color:var(--text-muted)">{def.validityDays}d</td>
								<td style="color:var(--text-muted)">{def.conditionSummary}</td>
								<td style="color:var(--text-muted)">{def.scopeName}</td>
							</tr>
						{/each}
					</tbody>
				</Table>
		{/if}
	</div>

	<div>
		<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;color:var(--ink);margin-bottom:14px">Issued coupons</div>
		{#if instances.isLoading}
			<PageLoading />
		{:else if instances.error}
			<p>Failed to load issued coupons: {instances.error.message}</p>
		{:else}
			{@const data = instances.data}
			<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
				<button onclick={() => setStatusFilter(null)} class="btn {statusFilter ? 'btn-ghost' : 'btn-outline'}">
					All <span class="mono">{Object.values(data.statusCounts).reduce((a, b) => a + b, 0)}</span>
				</button>
				{#each Object.entries(data.statusCounts) as [status, count] (status)}
					<button onclick={() => setStatusFilter(status)} class="btn {statusFilter === status ? 'btn-outline' : 'btn-ghost'}">
						{status} <span class="mono">{count}</span>
					</button>
				{/each}
			</div>

			{#if data.instances.length === 0}
				<EmptyState title="No coupons issued yet" body="Once customers qualify for a coupon, they'll show up here." />
			{:else}
				<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:14px">
					{#each data.instances as coupon (coupon.id)}
						<div class="stub" style="min-height:126px">
							<div class="stub-body">
								<div>
									<div style="font:600 15px/1.3 'IBM Plex Sans',sans-serif;color:var(--ink)">{coupon.defName}</div>
									<div class="mono" style="margin-top:6px;font:500 14px/1 'IBM Plex Mono',monospace;letter-spacing:.05em;color:var(--text-muted)">
										{coupon.code}
									</div>
								</div>
								<div>
									<div style="font:400 12px/1.4 'IBM Plex Sans',sans-serif;color:var(--text-muted)">{coupon.holder}</div>
									<div style="margin-top:9px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
										<Badge tone={statusTone[coupon.status] ?? 'grey'} text={coupon.status} />
										<span class="mono" style="font:400 12px 'IBM Plex Mono',monospace;color:var(--text-muted)">
											{new Date(coupon.expiresAt).toLocaleDateString()}
										</span>
									</div>
								</div>
							</div>
							<div class="stub-perforation"></div>
							<div class="stub-end" style="width:120px;flex:0 0 120px">
								<div style="text-align:center">
									<div class="mono" style="font:600 26px/1 'IBM Plex Mono',monospace;color:var(--stamp-amber)">{coupon.value}</div>
									<div style="margin-top:6px;font:500 9px/1 'IBM Plex Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)">off</div>
								</div>
							</div>
						</div>
					{/each}
				</div>
				<div style="margin-top:22px;display:flex;align-items:center;justify-content:space-between">
					<div style="font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
						Showing <span class="mono">{(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.instanceCount)}</span>
						of <span class="mono">{data.instanceCount}</span> coupons
					</div>
					<div style="display:flex;gap:8px">
						<button class="btn btn-ghost" disabled={data.page <= 1} onclick={() => goToPage(data.page - 1)}>Previous</button>
						<button class="btn btn-outline" disabled={data.page >= totalPages} onclick={() => goToPage(data.page + 1)}>Next</button>
					</div>
				</div>
			{/if}
		{/if}
	</div>
</div>

<Drawer bind:open={addOpen} title="Add a coupon type" note="Set the discount, validity, and who qualifies.">
	<form id="add-coupon-form" onsubmit={submitAdd}>
		<div style="display:flex;flex-direction:column;gap:18px">
			<label class="field">
				<span class="field-label">Name</span>
				<input type="text" bind:value={name} required class="input" placeholder="First Visit 10% Off" />
			</label>
			<label class="field">
				<span class="field-label">Discount</span>
				<div style="display:flex;align-items:center;border:1px solid var(--line);border-radius:8px;overflow:hidden">
					<input type="number" bind:value={discountValue} step="any" required min="0" class="mono" style="flex:1;height:38px;padding:0 11px;border:0;outline:none;font:500 14px 'IBM Plex Mono',monospace" />
					<select bind:value={discountType} style="height:38px;border:0;border-left:1px solid var(--line);background:var(--surface-soft);font:500 12px 'IBM Plex Sans',sans-serif;padding:0 9px">
						<option value="PERCENTAGE">%</option>
						<option value="FIXED">₹</option>
					</select>
				</div>
			</label>
			<label class="field">
				<span class="field-label">Validity (days)</span>
				<input type="number" bind:value={validityDays} required min="0" class="input mono" />
			</label>
			<label style="display:flex;align-items:center;gap:8px">
				<input type="checkbox" bind:checked={memberOnly} />
				<span class="field-label">Members only</span>
			</label>
			<label class="field">
				<span class="field-label">Applies to</span>
				<select bind:value={shopId} class="input">
					<option value="">All shops</option>
					{#each org.data?.shops ?? [] as shop (shop._id)}
						<option value={shop._id}>{shop.name}</option>
					{/each}
				</select>
			</label>
		</div>
	</form>
	{#if errorMessage}
		<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (addOpen = false)} disabled={addSaving}>Cancel</button>
		<button type="submit" form="add-coupon-form" class="btn btn-accent" disabled={addSaving}>
			{#if addSaving}<span class="spinner"></span>Adding…{:else}Add coupon type{/if}
		</button>
	{/snippet}
</Drawer>

<Drawer bind:open={editOpen} title={editingDef?.name ?? ''} note="Update this coupon type and who qualifies.">
	{#if editingDef}
		<div style="margin-bottom:16px">
			<IdLine id={editingDef._id} compact />
		</div>
		<form id="edit-coupon-form" onsubmit={submitUpdate}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Name</span>
					<input type="text" bind:value={name} required class="input" />
				</label>
				<label class="field">
					<span class="field-label">Discount</span>
					<div style="display:flex;align-items:center;border:1px solid var(--line);border-radius:8px;overflow:hidden">
						<input type="number" bind:value={discountValue} step="any" required min="0" class="mono" style="flex:1;height:38px;padding:0 11px;border:0;outline:none;font:500 14px 'IBM Plex Mono',monospace" />
						<select bind:value={discountType} style="height:38px;border:0;border-left:1px solid var(--line);background:var(--surface-soft);font:500 12px 'IBM Plex Sans',sans-serif;padding:0 9px">
							<option value="PERCENTAGE">%</option>
							<option value="FIXED">₹</option>
						</select>
					</div>
				</label>
				<label class="field">
					<span class="field-label">Validity (days)</span>
					<input type="number" bind:value={validityDays} required min="0" class="input mono" />
				</label>
				<label style="display:flex;align-items:center;gap:8px">
					<input type="checkbox" bind:checked={memberOnly} />
					<span class="field-label">Members only</span>
				</label>
				<label class="field">
					<span class="field-label">Applies to</span>
					<select bind:value={shopId} class="input">
						<option value="">All shops</option>
						{#each org.data?.shops ?? [] as shop (shop._id)}
							<option value={shop._id}>{shop.name}</option>
						{/each}
					</select>
				</label>
			</div>
		</form>
		<ConditionBuilder
			conditions={editingDef.conditions}
			onAdd={(input) => addCondition({ organizationId, couponDefinitionId: editingDef!._id, ...input } as never)}
			onRemove={(conditionId) => removeCondition({ organizationId, conditionId: conditionId as Id<'eligibilityConditions'> })}
		/>
		<button type="button" class="btn-danger-text" style="margin-top:4px" onclick={() => (deleteConfirmOpen = true)}>Delete this coupon type</button>
	{/if}
	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (editOpen = false)} disabled={editSaving}>Cancel</button>
		<button type="submit" form="edit-coupon-form" class="btn btn-accent" disabled={editSaving}>
			{#if editSaving}<span class="spinner"></span>Saving…{:else}Save coupon type{/if}
		</button>
	{/snippet}
</Drawer>

<AlertDialog
	bind:open={deleteConfirmOpen}
	title="Delete this coupon type?"
	body="Existing issued coupons of this type are unaffected, but no new ones can be issued. This can't be undone."
	confirmLabel="Delete coupon type"
	confirming={deleting}
	onconfirm={deleteDef}
/>
