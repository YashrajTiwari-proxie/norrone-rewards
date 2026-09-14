<script lang="ts">
	import { page } from '$app/state';
	import StatTicket from '$lib/components/StatTicket.svelte';
	import TierStamp from '$lib/components/TierStamp.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Drawer from '$lib/components/Drawer.svelte';
	import { tierColor } from '$lib/tierColor';
	import { useQuery, useMutation, useAction } from 'convex-svelte';
	import { PUBLIC_CONVEX_SITE_URL } from '$env/static/public';
	import { api } from '../../../../../../convex/_generated/api';
	import type { Id } from '../../../../../../convex/_generated/dataModel';

	let organizationId = $derived(page.params.orgId as Id<'organizations'>);
	let customerId = $derived(page.params.customerId as Id<'customers'>);

	const detail = useQuery(api.customers.getDetail, () => ({ organizationId, customerId }));
	const walletStatus = useQuery(api.wallet.configStatus, () => ({ organizationId }));

	const adjustPoints = useMutation(api.customerGrants.manualAdjustPoints);
	const grantTier = useMutation(api.customerGrants.manualGrantTier);
	const grantReward = useMutation(api.customerGrants.manualGrantReward);
	const grantCoupon = useMutation(api.customerGrants.manualGrantCoupon);
	const enrollMembership = useMutation(api.customerGrants.enrollMembership);
	const getPassLinkToken = useAction(api.wallet.getPassLinkToken);

	let walletBusy = $state<'apple' | 'google' | null>(null);

	async function openWalletLink(platform: 'apple' | 'google') {
		walletBusy = platform;
		errorMessage = null;
		try {
			const { token } = await getPassLinkToken({ organizationId, customerId });
			window.open(`${PUBLIC_CONVEX_SITE_URL}/v1/wallet/${platform}/${token}`, '_blank');
		} catch {
			errorMessage = `Failed to generate ${platform === 'apple' ? 'Apple' : 'Google'} Wallet link.`;
		} finally {
			walletBusy = null;
		}
	}

	let adjustOpen = $state(false);
	let changeTierOpen = $state(false);
	let grantRewardOpen = $state(false);
	let issueCouponOpen = $state(false);
	let enrollOpen = $state(false);

	let adjustSaving = $state(false);
	let changeTierSaving = $state(false);
	let grantRewardSaving = $state(false);
	let issueCouponSaving = $state(false);
	let enrollSaving = $state(false);

	let errorMessage = $state<string | null>(null);

	let amount = $state('');
	let reason = $state('');
	let selectedTierId = $state('');
	let selectedRewardId = $state('');
	let selectedCouponDefId = $state('');
	let selectedPlanId = $state('');

	const couponStatusTone: Record<string, 'green' | 'grey' | 'rust'> = {
		ISSUED: 'green',
		REDEEMED: 'grey',
		EXPIRED: 'rust',
		CANCELLED: 'grey'
	};

	async function submitAdjustPoints(event: SubmitEvent) {
		event.preventDefault();
		const amountNum = Number(amount);
		if (!Number.isFinite(amountNum) || amountNum === 0) {
			errorMessage = 'Enter a non-zero amount.';
			return;
		}
		adjustSaving = true;
		errorMessage = null;
		try {
			await adjustPoints({ customerId, amount: amountNum, note: reason.trim() || undefined });
			adjustOpen = false;
			amount = '';
			reason = '';
		} catch {
			errorMessage = 'Failed to adjust points.';
		} finally {
			adjustSaving = false;
		}
	}

	async function submitChangeTier(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedTierId) {
			errorMessage = 'Choose a tier.';
			return;
		}
		changeTierSaving = true;
		errorMessage = null;
		try {
			await grantTier({ customerId, tierId: selectedTierId as Id<'tiers'> });
			changeTierOpen = false;
		} catch {
			errorMessage = 'Failed to change tier.';
		} finally {
			changeTierSaving = false;
		}
	}

	async function submitGrantReward(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedRewardId) {
			errorMessage = 'Choose a reward.';
			return;
		}
		grantRewardSaving = true;
		errorMessage = null;
		try {
			await grantReward({ customerId, rewardId: selectedRewardId as Id<'rewardDefinitions'> });
			grantRewardOpen = false;
		} catch {
			errorMessage = 'Failed to grant reward.';
		} finally {
			grantRewardSaving = false;
		}
	}

	async function submitIssueCoupon(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedCouponDefId) {
			errorMessage = 'Choose a coupon.';
			return;
		}
		issueCouponSaving = true;
		errorMessage = null;
		try {
			await grantCoupon({ customerId, couponDefinitionId: selectedCouponDefId as Id<'couponDefinitions'> });
			issueCouponOpen = false;
		} catch {
			errorMessage = 'Failed to issue coupon.';
		} finally {
			issueCouponSaving = false;
		}
	}

	async function submitEnroll(event: SubmitEvent) {
		event.preventDefault();
		if (!selectedPlanId) {
			errorMessage = 'Choose a plan.';
			return;
		}
		enrollSaving = true;
		errorMessage = null;
		try {
			await enrollMembership({ customerId, planId: selectedPlanId as Id<'membershipPlans'> });
			enrollOpen = false;
		} catch {
			errorMessage = 'Failed to enroll membership.';
		} finally {
			enrollSaving = false;
		}
	}
</script>

{#if detail.isLoading}
	<div style="padding:40px">Loading…</div>
{:else if detail.error}
	<div style="padding:40px">Failed to load customer: {detail.error.message}</div>
{:else}
	{@const data = detail.data}
	<div style="padding:34px 40px 72px;max-width:1260px;display:flex;flex-direction:column;gap:34px">
		<a href="/orgs/{organizationId}/customers" style="align-self:flex-start;font:500 13px 'IBM Plex Sans',sans-serif">
			← Back to customers
		</a>

		<div class="card" style="padding:26px 28px;display:flex;gap:28px;align-items:center;flex-wrap:wrap">
			{#if data.currentTier}
				<TierStamp name={data.currentTier.name} level={data.currentTier.level} color={tierColor(data.currentTier.name)} size={78} />
			{/if}
			<div style="flex:1;min-width:220px">
				<div style="font:600 22px/1.2 'IBM Plex Sans',sans-serif;letter-spacing:-.01em;color:var(--ink)">{data.customer.name}</div>
				<div style="margin-top:7px;font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					{data.customer.shopName} · <span class="mono">{data.customer.externalId}</span>
					{#if data.customer.phone} · {data.customer.phone}{/if}
				</div>
				<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
					{#if data.membershipPlan}
						<Chip tone="green" text="Member · {data.membershipPlan.name}" />
						{#if data.membershipExpiry! > Date.now() + 100 * 365 * 24 * 60 * 60 * 1000}
							<Chip tone="amber" text="No expiry" />
						{:else}
							<Chip tone="amber" mono text="Renews {new Date(data.membershipExpiry!).toLocaleDateString()}" />
						{/if}
					{:else}
						<Chip tone="grey" text="Not a member" />
					{/if}
				</div>
			</div>
			<div style="display:flex;gap:10px;flex-wrap:wrap">
				<button class="btn btn-outline" onclick={() => { errorMessage = null; adjustOpen = true; }}>Adjust points</button>
				<button class="btn btn-outline" onclick={() => { errorMessage = null; changeTierOpen = true; }}>Change tier</button>
				<button class="btn btn-outline" onclick={() => { errorMessage = null; grantRewardOpen = true; }}>Grant reward</button>
				<button class="btn btn-outline" onclick={() => { errorMessage = null; issueCouponOpen = true; }}>Issue coupon</button>
				<button class="btn btn-outline" onclick={() => { errorMessage = null; enrollOpen = true; }}>Enroll in membership</button>
				<button
					class="btn btn-ghost"
					disabled={!walletStatus.data?.apple || walletBusy !== null}
					title={walletStatus.data?.apple ? undefined : 'Apple Wallet is not configured yet'}
					onclick={() => openWalletLink('apple')}
				>
					{#if walletBusy === 'apple'}<span class="spinner"></span>{/if}Add to Apple Wallet
				</button>
				<button
					class="btn btn-ghost"
					disabled={!walletStatus.data?.google || walletBusy !== null}
					title={walletStatus.data?.google ? undefined : 'Google Wallet is not configured yet'}
					onclick={() => openWalletLink('google')}
				>
					{#if walletBusy === 'google'}<span class="spinner"></span>{/if}Add to Google Wallet
				</button>
			</div>
		</div>

		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px">
			<StatTicket label="Point balance" value={data.pointBalance.toLocaleString()} big />
			<StatTicket label="Lifetime spend" value={`₹${data.customer.totalSpend.toLocaleString()}`} big />
			<StatTicket label="Visits" value={data.customer.visitCount.toLocaleString()} big />
			<StatTicket label="Rewards earned" value={String(data.rewards.length)} big />
		</div>

		<div>
			<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;margin-bottom:14px">Points earned by month</div>
			<div class="card" style="padding:24px 28px 20px">
				<div style="display:flex;align-items:flex-end;gap:14px;height:120px;border-bottom:1px solid var(--line);padding-bottom:2px">
					{#each data.months as m (m.label)}
						<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%">
							<div style="height:{Math.max(m.pct, 2)}%;background:var(--stamp-green);border-radius:2px 2px 0 0"></div>
						</div>
					{/each}
				</div>
				<div style="margin-top:10px;display:flex;gap:14px">
					{#each data.months as m (m.label)}
						<div style="flex:1;text-align:center">
							<div class="mono" style="font:500 12px/1 'IBM Plex Mono',monospace;color:var(--ink)">{m.total}</div>
							<div style="margin-top:5px;font:400 11px/1 'IBM Plex Sans',sans-serif;color:var(--text-muted)">{m.label}</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		{#if data.progress}
			<div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;margin-bottom:14px">Progress to {data.progress.nextTierName}</div>
				<div class="card" style="padding:24px 28px;display:flex;align-items:center;gap:26px;flex-wrap:wrap">
					<div style="font:400 13px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted);flex:1;min-width:200px">
						{data.progress.nextTierName} needs <span class="mono" style="color:var(--ink)">{data.progress.target.toLocaleString()}</span> —
						{data.customer.name} is at <span class="mono" style="color:var(--ink)">{data.progress.actual.toLocaleString()}</span>,
						<span class="mono" style="color:var(--stamp-amber)">{data.progress.remaining.toLocaleString()}</span> to go.
					</div>
				</div>
			</div>
		{/if}

		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:26px">
			<div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;margin-bottom:14px">Rewards earned</div>
				{#if data.rewards.length === 0}
					<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">No rewards yet.</div>
				{:else}
					<div style="display:flex;flex-direction:column;gap:12px">
						{#each data.rewards as r, i (i)}
							<div class="stub" style="min-height:88px">
								<div style="flex:1;min-width:0;padding:15px 18px">
									<div style="font:600 14px/1.3 'IBM Plex Sans',sans-serif;color:var(--ink)">{r.name}</div>
									<div style="margin-top:5px;font:400 12px/1.4 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
										Granted {new Date(r.grantedAt).toLocaleDateString()}
									</div>
								</div>
								<div class="stub-perforation"></div>
								<div class="stub-end" style="width:104px;flex:0 0 104px">
									<div style="font:500 9px/1.4 'IBM Plex Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--stamp-green);text-align:center">
										Reward<br />on file
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
			<div>
				<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;margin-bottom:14px">Coupons</div>
				{#if data.coupons.length === 0}
					<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">No coupons yet.</div>
				{:else}
					<div class="card" style="padding:4px 18px">
						{#each data.coupons as c, i (i)}
							<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 0;border-bottom:1px solid var(--line-2)">
								<div style="min-width:0">
									<div style="font:500 13px/1.3 'IBM Plex Sans',sans-serif;color:var(--ink)">{c.name}</div>
									<div class="mono" style="margin-top:4px;font:400 12px/1 'IBM Plex Mono',monospace;color:var(--text-muted)">{c.code}</div>
								</div>
								<div style="display:flex;align-items:center;gap:12px">
									<span class="mono" style="font:400 12px 'IBM Plex Mono',monospace;color:var(--text-muted)">{c.value}</span>
									<Chip tone={couponStatusTone[c.status] ?? 'grey'} text={c.status} />
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	<Drawer bind:open={adjustOpen} title="Adjust points" note="Add or remove points manually. This is recorded as a MANUAL ledger entry.">
		<form id="adjust-points-form" onsubmit={submitAdjustPoints}>
			<div style="display:flex;flex-direction:column;gap:18px">
				<label class="field">
					<span class="field-label">Amount (use a negative number to deduct)</span>
					<input type="number" bind:value={amount} step="any" required class="input mono" />
				</label>
				<label class="field">
					<span class="field-label">Reason (optional)</span>
					<input type="text" bind:value={reason} class="input" placeholder="Goodwill adjustment" />
				</label>
			</div>
		</form>
		{#if errorMessage}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (adjustOpen = false)} disabled={adjustSaving}>Cancel</button>
			<button type="submit" form="adjust-points-form" class="btn btn-accent" disabled={adjustSaving}>
				{#if adjustSaving}<span class="spinner"></span>Saving…{:else}Save adjustment{/if}
			</button>
		{/snippet}
	</Drawer>

	<Drawer bind:open={changeTierOpen} title="Change tier" note="This sets the customer's tier immediately, regardless of eligibility conditions.">
		<form id="change-tier-form" onsubmit={submitChangeTier}>
			<label class="field">
				<span class="field-label">New tier</span>
				<select bind:value={selectedTierId} required class="input">
					<option value="" disabled selected>Choose a tier</option>
					{#each data.tiers as tier (tier.id)}
						<option value={tier.id}>{tier.name} (Level {tier.level})</option>
					{/each}
				</select>
			</label>
		</form>
		{#if errorMessage}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (changeTierOpen = false)} disabled={changeTierSaving}>Cancel</button>
			<button type="submit" form="change-tier-form" class="btn btn-accent" disabled={changeTierSaving}>
				{#if changeTierSaving}<span class="spinner"></span>Saving…{:else}Save tier{/if}
			</button>
		{/snippet}
	</Drawer>

	<Drawer bind:open={grantRewardOpen} title="Grant reward" note="Gives this customer the reward immediately, without checking its eligibility conditions.">
		{#if data.availableRewards.length === 0}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
				This customer already holds every reward configured for their shop.
			</div>
		{:else}
			<form id="grant-reward-form" onsubmit={submitGrantReward}>
				<label class="field">
					<span class="field-label">Reward</span>
					<select bind:value={selectedRewardId} required class="input">
						<option value="" disabled selected>Choose a reward</option>
						{#each data.availableRewards as reward (reward.id)}
							<option value={reward.id}>{reward.name}</option>
						{/each}
					</select>
				</label>
			</form>
		{/if}
		{#if errorMessage}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (grantRewardOpen = false)} disabled={grantRewardSaving}>Cancel</button>
			{#if data.availableRewards.length > 0}
				<button type="submit" form="grant-reward-form" class="btn btn-accent" disabled={grantRewardSaving}>
					{#if grantRewardSaving}<span class="spinner"></span>Granting…{:else}Grant reward{/if}
				</button>
			{/if}
		{/snippet}
	</Drawer>

	<Drawer bind:open={issueCouponOpen} title="Issue coupon" note="Generates a new coupon code for this customer immediately, without checking its eligibility conditions.">
		{#if data.availableCoupons.length === 0}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">No coupon types configured for this shop yet.</div>
		{:else}
			<form id="issue-coupon-form" onsubmit={submitIssueCoupon}>
				<label class="field">
					<span class="field-label">Coupon type</span>
					<select bind:value={selectedCouponDefId} required class="input">
						<option value="" disabled selected>Choose a coupon</option>
						{#each data.availableCoupons as def (def.id)}
							<option value={def.id}>{def.name} (valid {def.validityDays}d)</option>
						{/each}
					</select>
				</label>
			</form>
		{/if}
		{#if errorMessage}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (issueCouponOpen = false)} disabled={issueCouponSaving}>Cancel</button>
			{#if data.availableCoupons.length > 0}
				<button type="submit" form="issue-coupon-form" class="btn btn-accent" disabled={issueCouponSaving}>
					{#if issueCouponSaving}<span class="spinner"></span>Issuing…{:else}Issue coupon{/if}
				</button>
			{/if}
		{/snippet}
	</Drawer>

	<Drawer bind:open={enrollOpen} title="Enroll in membership" note="Starts the plan immediately, applies its benefits, and re-checks tier/reward/coupon eligibility — same as if the customer paid for it through the API.">
		{#if data.availablePlans.length === 0}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
				No other membership plans available — the customer may already be enrolled in all of them.
			</div>
		{:else}
			<form id="enroll-form" onsubmit={submitEnroll}>
				<label class="field">
					<span class="field-label">Plan</span>
					<select bind:value={selectedPlanId} required class="input">
						<option value="" disabled selected>Choose a plan</option>
						{#each data.availablePlans as plan (plan.id)}
							<option value={plan.id}>{plan.name} — {plan.price != null ? `₹${plan.price}` : 'Free'}</option>
						{/each}
					</select>
				</label>
			</form>
		{/if}
		{#if errorMessage}
			<div style="font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
		{/if}
		{#snippet footer()}
			<button type="button" class="btn btn-ghost" onclick={() => (enrollOpen = false)} disabled={enrollSaving}>Cancel</button>
			{#if data.availablePlans.length > 0}
				<button type="submit" form="enroll-form" class="btn btn-accent" disabled={enrollSaving}>
					{#if enrollSaving}<span class="spinner"></span>Enrolling…{:else}Enroll{/if}
				</button>
			{/if}
		{/snippet}
	</Drawer>
{/if}
