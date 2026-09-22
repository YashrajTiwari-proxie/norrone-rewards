<script lang="ts">
	import '$lib/styles/tokens.css';
	import RegionCurrencyFields from '$lib/components/RegionCurrencyFields.svelte';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { useQuery, useMutation, useAuth } from 'convex-svelte';
	import { api } from '../../../convex/_generated/api';
	import { goto } from '$app/navigation';
	import type { Id } from '../../../convex/_generated/dataModel';

	const auth = getPlatformAuthContext();
	const regions = useQuery(api.regions.list, {});
	const createSelfServe = useMutation(api.organizations.createSelfServe);
	const convexAuth = useAuth();

	/**
	 * refreshSession() only waits for Better Auth's own session store to
	 * settle — convex-svelte's setupAuth() reacts to that in a separate
	 * $effect that then asynchronously calls client.setAuth(fetchAccessToken)
	 * on the Convex websocket. Calling a Convex mutation that requires
	 * ctx.auth.getUserIdentity() right after refreshSession() can race
	 * ahead of that handshake — wait for Convex's own auth state too.
	 */
	async function waitForConvexAuth(timeoutMs = 5000): Promise<boolean> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			if (convexAuth.isAuthenticated) return true;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return false;
	}

	let step = $state<1 | 2>(1);

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');

	let orgName = $state('');
	let phoneNumber = $state('');
	let website = $state('');
	let address = $state('');
	let regionId = $state('');
	let currencyCode = $state('');

	let submittingStep1 = $state(false);
	let submittingStep2 = $state(false);
	let errorMessage = $state<string | null>(null);

	async function submitAccount(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = null;

		if (password.length < 8) {
			errorMessage = 'Password must be at least 8 characters.';
			return;
		}
		if (password !== confirmPassword) {
			errorMessage = 'Passwords do not match.';
			return;
		}

		submittingStep1 = true;
		const { error: signUpError } = await auth.authClient.signUp.email({ email, password, name });
		if (signUpError) {
			errorMessage = signUpError.message?.toLowerCase().includes('already')
				? 'An account with this email already exists. Try signing in instead.'
				: 'Failed to create your account. Please try again.';
			submittingStep1 = false;
			return;
		}
		await auth.refreshSession();
		const convexReady = await waitForConvexAuth();
		submittingStep1 = false;
		if (!convexReady) {
			errorMessage = 'Your account was created, but signing you in is taking longer than expected. Please sign in.';
			return;
		}
		step = 2;
	}

	async function submitOrganization(event: SubmitEvent) {
		event.preventDefault();
		errorMessage = null;
		submittingStep2 = true;
		try {
			const { organizationId } = await createSelfServe({
				name: orgName.trim(),
				phoneNumber: phoneNumber.trim() || undefined,
				website: website.trim() || undefined,
				address: address.trim() || undefined,
				regionId: (regionId || undefined) as Id<'regions'> | undefined,
				currencyCode: currencyCode.trim() ? currencyCode.trim().toUpperCase() : undefined
			});
			await goto(`/orgs/${organizationId}/shops`);
		} catch {
			errorMessage = 'Your account was created, but setting up your organization failed. Please sign in and try again.';
			submittingStep2 = false;
		}
	}
</script>

<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family:'IBM Plex Sans',sans-serif">
	<div style="width:100%;max-width:420px">
		<div style="display:flex;align-items:center;gap:10px;margin-bottom:34px">
			<div style="width:26px;height:26px;background:var(--ink);border-radius:3px"></div>
			<div style="font:600 15px/1 'IBM Plex Sans',sans-serif;letter-spacing:-.01em;color:var(--ink)">Norrone Rewards</div>
		</div>
		<div class="card" style="padding:32px">
			<div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
				<div style="flex:1;height:4px;border-radius:2px;background:var(--ink)"></div>
				<div style="flex:1;height:4px;border-radius:2px;background:{step === 2 ? 'var(--ink)' : 'var(--line)'}"></div>
			</div>
			<div style="font:500 11px/1 'IBM Plex Sans',sans-serif;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted)">
				Step {step} of 2
			</div>

			{#if step === 1}
				<div style="margin-top:8px;font:600 21px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
					Create your account
				</div>
				<div style="margin-top:8px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					You'll be the owner of your organization.
				</div>
				<form onsubmit={submitAccount} style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
					<label class="field">
						<span class="field-label">Your name</span>
						<input type="text" bind:value={name} required class="input" />
					</label>
					<label class="field">
						<span class="field-label">Work email</span>
						<input type="email" bind:value={email} required class="input" />
					</label>
					<label class="field">
						<span class="field-label">Password</span>
						<input type="password" bind:value={password} required minlength="8" class="input mono" />
						<span style="margin-top:5px;font:400 12px 'IBM Plex Sans',sans-serif;color:var(--text-muted)">At least 8 characters.</span>
					</label>
					<label class="field">
						<span class="field-label">Confirm password</span>
						<input type="password" bind:value={confirmPassword} required minlength="8" class="input mono" />
					</label>
					<button type="submit" class="btn btn-primary" style="width:100%;height:40px" disabled={submittingStep1}>
						{#if submittingStep1}<span class="spinner"></span>Creating your account…{:else}Continue{/if}
					</button>
				</form>
			{:else}
				<div style="margin-top:8px;font:600 21px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
					Set up your organization
				</div>
				<div style="margin-top:8px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
					A few details about your business.
				</div>
				<form onsubmit={submitOrganization} style="margin-top:24px;display:flex;flex-direction:column;gap:16px">
					<label class="field">
						<span class="field-label">Organization name</span>
						<input type="text" bind:value={orgName} required class="input" />
					</label>
					<label class="field">
						<span class="field-label">Phone number</span>
						<input type="tel" bind:value={phoneNumber} required class="input" />
					</label>
					<label class="field">
						<span class="field-label">Website (optional)</span>
						<input type="url" bind:value={website} class="input" />
					</label>
					<label class="field">
						<span class="field-label">Address</span>
						<input type="text" bind:value={address} required class="input" />
					</label>
					<RegionCurrencyFields regions={regions.data ?? []} bind:regionId bind:currencyCode />
					<button type="submit" class="btn btn-primary" style="width:100%;height:40px" disabled={submittingStep2}>
						{#if submittingStep2}<span class="spinner"></span>Creating your organization…{:else}Create organization{/if}
					</button>
				</form>
			{/if}
			{#if errorMessage}
				<div style="margin-top:14px;font:400 13px 'IBM Plex Sans',sans-serif;color:var(--stamp-rust)">{errorMessage}</div>
			{/if}
			{#if step === 1}
				<div style="margin-top:18px;text-align:center;font:400 13px 'IBM Plex Sans',sans-serif">
					Already have an account? <a href="/login">Sign in</a>
				</div>
			{/if}
		</div>
	</div>
</div>
