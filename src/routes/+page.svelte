<script lang="ts">
	import { useQuery, useAuth } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import { getPlatformAuthContext } from '$lib/platformAuth';
	import { goto } from '$app/navigation';
	import PageLoading from '$lib/components/PageLoading.svelte';
	import Icon from '$lib/components/Icon.svelte';

	const auth = getPlatformAuthContext();
	const convexAuth = useAuth();
	const orgs = useQuery(api.organizations.myOrganizations, () => (convexAuth.isAuthenticated ? {} : 'skip'));

	// Staff belong to exactly one org in the common case — skip the picker
	// and land straight in their shops instead of an intermediate list.
	$effect(() => {
		if (orgs.data && orgs.data.length === 1) {
			goto(`/orgs/${orgs.data[0]._id}/shops`, { replaceState: true });
		}
	});

	async function logOut() {
		await auth.authClient.signOut();
		await goto('/login');
	}

	const features = [
		{
			icon: 'layers',
			title: 'Tiers & membership',
			body: 'Reward loyalty with tiers and paid membership plans that unlock perks automatically.'
		},
		{
			icon: 'coin',
			title: 'Points that just work',
			body: 'Grant and track points from any spend or visit event, with a full ledger per customer.'
		},
		{
			icon: 'gift',
			title: 'Rewards & coupons',
			body: 'Set up qualifying conditions once — rewards and coupons issue themselves.'
		},
		{
			icon: 'contactless',
			title: 'Apple & Google Wallet',
			body: 'Customers add a real wallet pass that updates live as their points and tier change.'
		},
		{
			icon: 'terminal',
			title: 'A public API',
			body: 'Plug your website or POS straight in — every action available over a documented REST API.'
		},
		{
			icon: 'store',
			title: 'Built for multi-shop',
			body: 'Run one program across every location, or scope plans and rewards to a single shop.'
		}
	];

	const steps = [
		{ n: 1, title: 'Connect POS & Web', body: 'Integrate your website, POS, or any custom stack via the plug-and-play REST API.' },
		{ n: 2, title: 'Define tier rules', body: 'Set custom earning multipliers, qualifying conditions, and paid subscription plans.' },
		{ n: 3, title: 'Passes in wallets', body: "Customers add their pass with one tap, straight into Apple Wallet or Google Wallet." },
		{ n: 4, title: 'Real-time sync', body: 'Every swipe, scan, or checkout updates their pass and logs to your ledger instantly.' }
	];

	let heroPoints = $state(2450);
	function simulateSpend() {
		heroPoints += 150;
	}

	let copyLabel = $state('Copy snippet');
	function copySnippet() {
		const snippet = `curl -X POST https://api.norrone.com/v1/passes/issue \\
  -H "Authorization: Bearer nr_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{"customer": {"id": "usr_9812", "name": "Sophia Vance"}, "initial_balance": 2450}'`;
		navigator.clipboard?.writeText(snippet);
		copyLabel = 'Copied!';
		setTimeout(() => (copyLabel = 'Copy snippet'), 1600);
	}
</script>

{#if convexAuth.isLoading}
	<div style="min-height:100vh;display:grid;place-items:center"><PageLoading /></div>
{:else if convexAuth.isAuthenticated}
	<div style="max-width:640px;margin:60px auto;padding:0 24px;font-family:'Inter',sans-serif">
		{#if orgs.isLoading || (orgs.data && orgs.data.length === 1)}
			<PageLoading />
		{:else if orgs.error}
			<p>Failed to load organizations: {orgs.error.message}</p>
		{:else if orgs.data.length === 0}
			<p>No organizations yet — ask an owner to add you as staff, or <a href="/signup">create one</a>.</p>
		{:else}
			<h1>Your organizations</h1>
			<ul>
				{#each orgs.data as org (org._id)}
					<li><a href="/orgs/{org._id}/shops">{org.name}</a> <span style="color:var(--text-muted)">({org.role})</span></li>
				{/each}
			</ul>
			<button type="button" class="btn" onclick={logOut}>Log out</button>
		{/if}
	</div>
{:else}
	<div class="landing">
		<header class="l-header">
			<div class="l-header-inner">
				<div class="l-brand">
					<img src="/norrone_rewards.svg" alt="Norrone Rewards" width="28" height="28" style="border-radius:6px" />
					<span class="l-brand-name">Norrone Rewards</span>
				</div>
				<nav class="l-nav">
					<a href="#features">Features</a>
					<a href="#architecture">Loyalty Architecture</a>
					<a href="#wallet">Apple &amp; Google Wallet</a>
					<a href="/api-demo">API Docs</a>
				</nav>
				<div class="l-header-cta">
					<a href="/login" class="btn btn-ghost">Sign in</a>
					<a href="/signup" class="btn btn-primary">Set up your organization</a>
				</div>
			</div>
		</header>

		<main>
			<section class="l-hero">
				<div class="l-hero-pills">
					<span class="l-pill l-pill-card"><span class="l-live-dot"></span>v1 REST API Live</span>
					<span class="l-pill l-pill-muted"><Icon name="wallet" size={14} />Apple &amp; Google Wallet Ready</span>
					<span class="l-pill l-pill-card l-pill-hide-sm">Multi-shop architecture</span>
				</div>
				<h1 class="l-hero-title">
					Loyalty programs your customers <span class="l-hero-title-accent">actually use</span>
				</h1>
				<p class="l-hero-sub">
					Points, tiers, rewards, coupons, and real Apple &amp; Google Wallet passes — run across every shop, driven by
					a public API your website or POS can call directly.
				</p>
				<div class="l-hero-cta">
					<a href="/signup" class="btn btn-primary l-hero-btn">
						<span>Set up your organization</span>
						<Icon name="arrowRight" size={16} />
					</a>
					<a href="/login" class="btn btn-outline l-hero-btn">Sign in</a>
					<a href="/api-demo" class="l-text-link l-hero-btn">
						<Icon name="terminal" size={16} />
						<span>Explore API Docs</span>
					</a>
				</div>
				<div class="l-trust-row">
					<span><Icon name="sync" size={14} />Syncs across POS, web &amp; mobile</span>
					<span><Icon name="smartphone" size={14} />Zero app install needed</span>
					<span><Icon name="bolt" size={14} />&lt;45ms ledger response</span>
				</div>

				<div class="l-mockups" id="wallet">
					<div class="l-pass-card">
						<div class="l-pass-glow"></div>
						<div class="l-pass-head">
							<div class="l-pass-head-left">
								<div class="l-pass-icon"><Icon name="gift" size={16} /></div>
								<div>
									<p class="l-pass-name">Norrone Member</p>
									<p class="l-pass-label">Official digital pass</p>
								</div>
							</div>
							<span class="l-pass-active">Active</span>
						</div>
						<div class="l-pass-body">
							<div class="l-pass-row">
								<div>
									<span class="l-pass-label">Customer</span>
									<p class="l-pass-value">Sophia Vance</p>
								</div>
								<div class="l-pass-right">
									<span class="l-pass-tier"><Icon name="stars" size={12} />VIP Platinum</span>
									<span class="l-pass-mono">#NOR-94021</span>
								</div>
							</div>
							<div class="l-pass-row l-pass-row-bottom">
								<div>
									<span class="l-pass-label">Available balance</span>
									<div class="l-pass-points">
										<span>{heroPoints.toLocaleString()}</span>
										<span class="l-pass-pts">PTS</span>
									</div>
								</div>
								<div class="l-pass-right">
									<span class="l-pass-label">Tier multiplier</span>
									<p class="l-pass-value l-pass-value-sm">2.5x per $1</p>
								</div>
							</div>
						</div>
						<div class="l-pass-barcode">
							<svg width="100%" height="36" viewBox="0 0 200 36" fill="currentColor" aria-hidden="true">
								<rect x="0" y="0" width="4" height="36" /><rect x="7" y="0" width="2" height="36" /><rect x="12" y="0" width="6" height="36" /><rect x="22" y="0" width="3" height="36" /><rect x="28" y="0" width="8" height="36" /><rect x="40" y="0" width="2" height="36" /><rect x="45" y="0" width="5" height="36" /><rect x="54" y="0" width="3" height="36" /><rect x="61" y="0" width="7" height="36" /><rect x="72" y="0" width="2" height="36" /><rect x="78" y="0" width="9" height="36" /><rect x="91" y="0" width="3" height="36" /><rect x="98" y="0" width="6" height="36" /><rect x="108" y="0" width="2" height="36" /><rect x="114" y="0" width="4" height="36" /><rect x="122" y="0" width="8" height="36" /><rect x="134" y="0" width="3" height="36" /><rect x="141" y="0" width="5" height="36" /><rect x="150" y="0" width="2" height="36" /><rect x="156" y="0" width="7" height="36" /><rect x="167" y="0" width="4" height="36" /><rect x="175" y="0" width="2" height="36" /><rect x="181" y="0" width="6" height="36" /><rect x="191" y="0" width="3" height="36" /><rect x="197" y="0" width="3" height="36" />
							</svg>
							<div class="l-pass-barcode-label"><Icon name="contactless" size={12} />Hold near terminal to redeem</div>
						</div>
						<div class="l-pass-push">
							<span class="l-live-dot"></span>
							<span>Pass auto-updated via push notification</span>
						</div>
					</div>

					<div class="l-ledger-card">
						<div class="l-ledger-head">
							<div class="l-ledger-head-left">
								<span class="l-live-dot"></span>
								<h3>Live ledger ingestion stream</h3>
							</div>
							<span class="l-mono-pill">POST /v1/events/spend</span>
						</div>
						<div class="l-ledger-rows">
							<div class="l-ledger-row">
								<div><span class="l-ledger-pos">+185 pts</span><span class="l-ledger-desc">POS Order #8194 — Soho Flagship Store</span></div>
								<span class="l-ledger-time">12s ago</span>
							</div>
							<div class="l-ledger-row">
								<div><span class="l-ledger-tier">Tier Upgrade</span><span class="l-ledger-desc">Customer #NOR-94021 reached VIP Platinum</span></div>
								<span class="l-ledger-time">45s ago</span>
							</div>
							<div class="l-ledger-row">
								<div><span class="l-ledger-neg">-500 pts</span><span class="l-ledger-desc">Voucher claim: "$10 Espresso Flight" applied</span></div>
								<span class="l-ledger-time">2m ago</span>
							</div>
							<div class="l-ledger-row">
								<div><span class="l-ledger-pos">+420 pts</span><span class="l-ledger-desc">Web checkout — Order #9940</span></div>
								<span class="l-ledger-time">5m ago</span>
							</div>
						</div>
						<div class="l-ledger-sim">
							<div class="l-ledger-sim-left"><Icon name="bolt" size={16} />Test real-time propagation:</div>
							<button type="button" class="btn btn-primary l-sim-btn" onclick={simulateSpend}>Simulate +150 PTS spend</button>
						</div>
					</div>
				</div>
			</section>

			<section class="l-stats">
				<div class="l-stats-grid">
					<div><span class="l-stat-num">99.99%</span><span class="l-stat-label">Uptime SLA</span></div>
					<div><span class="l-stat-num">&lt;45ms</span><span class="l-stat-label">Global API latency</span></div>
					<div><span class="l-stat-num">100%</span><span class="l-stat-label">Native pass compatibility</span></div>
					<div><span class="l-stat-num">0 Apps</span><span class="l-stat-label">Install overhead</span></div>
				</div>
			</section>

			<section class="l-section" id="features">
				<div class="l-section-head">
					<div>
						<span class="l-eyebrow">Modular architecture</span>
						<h2 class="l-h2">Engineered for immediate consumer adoption</h2>
					</div>
					<p class="l-section-sub">Everything required to power automated rewards across every register or online cart.</p>
				</div>
				<div class="l-feature-grid">
					{#each features as f (f.title)}
						<div class="l-feature-card">
							<div class="l-feature-icon"><Icon name={f.icon} size={20} /></div>
							<h3>{f.title}</h3>
							<p>{f.body}</p>
						</div>
					{/each}
				</div>
			</section>

			<section class="l-section l-section-tinted" id="architecture">
				<div class="l-section-head l-section-head-center">
					<span class="l-eyebrow">Implementation</span>
					<h2 class="l-h2">How modern brands deploy Norrone in hours</h2>
					<p class="l-section-sub">A turnkey ledger with frictionless POS and wallet integrations.</p>
				</div>
				<div class="l-steps-grid">
					{#each steps as s (s.n)}
						<div class="l-step-card">
							<div class="l-step-num">{s.n}</div>
							<h3>{s.title}</h3>
							<p>{s.body}</p>
						</div>
					{/each}
				</div>
			</section>

			<section class="l-section l-dev-grid">
				<div>
					<span class="l-eyebrow">Developer first</span>
					<h2 class="l-h2">Simple REST contracts. Guaranteed zero state drift.</h2>
					<p class="l-section-sub" style="margin-top:12px">
						Every reward event is idempotent and auditable. Plug in with standard cURL requests from Node, Python, or Go.
					</p>
					<div class="l-dev-checks">
						<div>
							<Icon name="checkCircle" size={20} />
							<div>
								<p class="l-dev-check-title">Idempotent transactions</p>
								<p class="l-dev-check-body">Prevent duplicate point grants even with spotty POS internet connections.</p>
							</div>
						</div>
						<div>
							<Icon name="checkCircle" size={20} />
							<div>
								<p class="l-dev-check-title">Automated pass signing</p>
								<p class="l-dev-check-body">Norrone handles Apple APNs certificates and Google Cloud credentials automatically.</p>
							</div>
						</div>
					</div>
				</div>
				<div class="l-terminal">
					<div class="l-terminal-bar">
						<div class="l-terminal-dots"><span></span><span></span><span></span><span class="l-terminal-path">POST /v1/passes/issue</span></div>
						<button type="button" class="l-terminal-copy" onclick={copySnippet}>
							<Icon name="copy" size={14} />
							{copyLabel}
						</button>
					</div>
					<pre class="l-terminal-body">curl -X POST https://api.norrone.com/v1/passes/issue \
  -H "Authorization: Bearer nr_live_..." \
  -H "Content-Type: application/json" \
  -d '{'{'}
    "customer": {'{'} "id": "usr_9812", "name": "Sophia Vance" {'}'},
    "initial_balance": 2450,
    "tier": "vip_platinum"
  {'}'}'</pre>
					<div class="l-terminal-footer">
						<span class="l-live-dot"></span>
						<span>HTTP 201 Created (24ms)</span>
					</div>
				</div>
			</section>

			<section class="l-section">
				<div class="l-cta-card">
					<span class="l-eyebrow l-eyebrow-light">Launch in less than a day</span>
					<h2 class="l-h2 l-h2-light">Ready to launch loyalty customers will actually keep in their pocket?</h2>
					<p class="l-cta-sub">
						Get your production API keys, design your branded wallet pass, and test your first point grant in under 15
						minutes.
					</p>
					<a href="/signup" class="btn l-cta-btn">
						<span>Set up your organization</span>
						<Icon name="arrowRight" size={16} />
					</a>
				</div>
			</section>
		</main>

		<footer class="l-footer">
			<div class="l-footer-grid">
				<div class="l-footer-brand">
					<div class="l-brand">
						<img src="/norrone_rewards.svg" alt="Norrone Rewards" width="24" height="24" style="border-radius:5px" />
						<span class="l-brand-name">Norrone Rewards</span>
					</div>
					<p>Next-generation loyalty and wallet-pass infrastructure for modern digital products.</p>
				</div>
				<div class="l-footer-col">
					<span class="l-footer-heading">Platform</span>
					<a href="/signup">Get started</a>
					<a href="/login">Sign in</a>
					<a href="#features">Features</a>
				</div>
				<div class="l-footer-col">
					<span class="l-footer-heading">Developers</span>
					<a href="/api-demo">API reference</a>
					<a href="/wallet-demo">Wallet demo</a>
				</div>
				<div class="l-footer-col">
					<span class="l-footer-heading">Trust &amp; governance</span>
					<span class="l-footer-trust"><Icon name="shield" size={16} />Multi-tenant isolation</span>
					<span class="l-footer-trust"><Icon name="lock" size={16} />Signed wallet credentials</span>
				</div>
			</div>
			<div class="l-footer-bottom">
				<p>© {new Date().getFullYear()} Norrone Rewards</p>
			</div>
		</footer>
	</div>
{/if}

<style>
	.landing {
		background: var(--paper);
		font-family: 'Inter', sans-serif;
		color: var(--text);
	}
	main {
		display: flex;
		flex-direction: column;
	}

	/* Header */
	.l-header {
		position: sticky;
		top: 0;
		z-index: 30;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--line);
	}
	.l-header-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 24px;
		height: 64px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
	}
	.l-brand {
		display: flex;
		align-items: center;
		gap: 9px;
		flex: none;
	}
	.l-brand-name {
		font: 600 15px/1 'Plus Jakarta Sans', sans-serif;
		letter-spacing: -0.01em;
		color: var(--ink);
	}
	.l-nav {
		display: flex;
		align-items: center;
		gap: 22px;
		flex: 1;
		justify-content: center;
	}
	.l-nav a {
		font: 400 13px 'Inter', sans-serif;
		color: var(--text-muted);
	}
	.l-nav a:hover {
		color: var(--ink);
		text-decoration: none;
	}
	.l-header-cta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}

	/* Hero */
	.l-hero {
		max-width: 1000px;
		margin: 0 auto;
		padding: 56px 24px 40px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.l-hero-pills {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-bottom: 20px;
	}
	.l-pill {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		border-radius: 999px;
		font: 600 11px/1 'Inter', sans-serif;
		letter-spacing: 0.02em;
	}
	.l-pill-card {
		background: var(--card);
		color: var(--ink);
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
	}
	.l-pill-muted {
		background: var(--surface-soft);
		color: var(--ink-3);
	}
	.l-live-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent-emerald);
		flex: none;
	}
	.l-hero-title {
		font: 700 44px/1.12 'Plus Jakarta Sans', sans-serif;
		letter-spacing: -0.03em;
		color: var(--ink);
		max-width: 760px;
		margin: 0 0 16px;
	}
	.l-hero-title-accent {
		background: linear-gradient(90deg, var(--ink), var(--ink-2), var(--accent-indigo));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}
	.l-hero-sub {
		font: 400 17px/1.6 'Inter', sans-serif;
		letter-spacing: -0.01em;
		color: var(--text-muted);
		max-width: 580px;
		margin: 0 0 28px;
	}
	.l-hero-cta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 10px;
		margin-bottom: 28px;
	}
	.l-hero-btn {
		height: 44px;
		padding: 0 20px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font: 600 14px 'Inter', sans-serif;
	}
	.l-text-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--text-muted);
		font: 500 14px 'Inter', sans-serif;
	}
	.l-text-link:hover {
		color: var(--ink);
		text-decoration: none;
	}
	.l-trust-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 22px;
		margin-bottom: 44px;
	}
	.l-trust-row span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font: 600 11px/1 'Inter', sans-serif;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.l-trust-row :global(svg) {
		color: var(--accent-emerald);
	}

	/* Mockups */
	.l-mockups {
		width: 100%;
		max-width: 940px;
		display: grid;
		grid-template-columns: 5fr 7fr;
		gap: 20px;
		align-items: start;
		text-align: left;
	}
	.l-pass-card {
		position: relative;
		border-radius: 16px;
		padding: 18px;
		background: linear-gradient(180deg, var(--ink-2), var(--surface-dark));
		color: #fff;
		overflow: hidden;
		box-shadow: 0 20px 44px rgba(15, 23, 42, 0.22);
	}
	.l-pass-glow {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 5px;
		background: linear-gradient(90deg, var(--accent-emerald), var(--accent-indigo));
	}
	.l-pass-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}
	.l-pass-head-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.l-pass-icon {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.1);
		display: grid;
		place-items: center;
		color: var(--accent-emerald);
	}
	.l-pass-name {
		font: 600 13px/1.2 'Inter', sans-serif;
		margin: 0;
	}
	.l-pass-label {
		font: 600 9px/1.4 'Inter', sans-serif;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(255, 255, 255, 0.5);
		margin: 2px 0 0;
	}
	.l-pass-active {
		padding: 3px 9px;
		border-radius: 999px;
		background: rgba(16, 185, 129, 0.18);
		color: var(--accent-emerald);
		font: 700 9px/1 'Inter', sans-serif;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.l-pass-body {
		border-radius: 12px;
		background: rgba(255, 255, 255, 0.06);
		padding: 14px;
		margin-bottom: 14px;
	}
	.l-pass-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.l-pass-row-bottom {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		align-items: baseline;
	}
	.l-pass-right {
		text-align: right;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
	}
	.l-pass-value {
		font: 600 18px/1.2 'Plus Jakarta Sans', sans-serif;
		margin: 2px 0 0;
	}
	.l-pass-value-sm {
		font-size: 14px;
	}
	.l-pass-tier {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font: 700 10px/1 'Inter', sans-serif;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--accent-amber);
	}
	.l-pass-mono {
		font: 500 11px 'JetBrains Mono', monospace;
		color: rgba(255, 255, 255, 0.55);
	}
	.l-pass-points {
		display: flex;
		align-items: baseline;
		gap: 6px;
		font: 700 30px/1 'Plus Jakarta Sans', sans-serif;
		letter-spacing: -0.02em;
	}
	.l-pass-pts {
		font: 700 11px/1 'Inter', sans-serif;
		color: var(--accent-emerald);
	}
	.l-pass-barcode {
		border-radius: 10px;
		background: #fff;
		color: var(--ink);
		padding: 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.l-pass-barcode-label {
		display: flex;
		align-items: center;
		gap: 5px;
		font: 500 10px 'JetBrains Mono', monospace;
		color: var(--text-muted);
	}
	.l-pass-push {
		margin-top: 12px;
		display: flex;
		align-items: center;
		gap: 8px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		padding: 9px 12px;
		font: 400 12px 'Inter', sans-serif;
	}

	.l-ledger-card {
		border-radius: 16px;
		background: var(--card);
		box-shadow: 0 12px 32px rgba(15, 23, 42, 0.06);
		padding: 20px;
	}
	.l-ledger-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 14px;
	}
	.l-ledger-head-left {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.l-ledger-head-left h3 {
		font: 600 15px 'Plus Jakarta Sans', sans-serif;
		margin: 0;
		color: var(--ink);
	}
	.l-mono-pill {
		font: 500 11px 'JetBrains Mono', monospace;
		background: var(--surface-soft);
		color: var(--ink-3);
		padding: 4px 9px;
		border-radius: 6px;
	}
	.l-ledger-rows {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.l-ledger-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 9px 10px;
		border-radius: 8px;
		background: var(--surface-soft);
	}
	.l-ledger-row > div:first-child {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.l-ledger-pos,
	.l-ledger-tier,
	.l-ledger-neg {
		font: 700 12px 'JetBrains Mono', monospace;
		flex: none;
	}
	.l-ledger-pos {
		color: var(--accent-emerald);
	}
	.l-ledger-tier {
		color: var(--accent-indigo);
	}
	.l-ledger-neg {
		color: var(--stamp-rust);
	}
	.l-ledger-desc {
		font: 400 12px 'JetBrains Mono', monospace;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.l-ledger-time {
		font: 400 11px 'JetBrains Mono', monospace;
		color: var(--text-muted);
		flex: none;
	}
	.l-ledger-sim {
		margin-top: 14px;
		padding: 10px;
		border-radius: 10px;
		background: var(--paper);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.l-ledger-sim-left {
		display: flex;
		align-items: center;
		gap: 8px;
		font: 400 13px 'Inter', sans-serif;
		color: var(--ink);
	}
	.l-sim-btn {
		height: 34px;
		padding: 0 14px;
		font-size: 12px;
	}

	/* Stats strip */
	.l-stats {
		background: var(--surface-soft);
		padding: 40px 24px;
	}
	.l-stats-grid {
		max-width: 1000px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 20px;
		text-align: center;
	}
	.l-stats-grid > div {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.l-stat-num {
		font: 700 28px/1 'Plus Jakarta Sans', sans-serif;
		color: var(--ink);
	}
	.l-stat-label {
		font: 600 10px/1 'Inter', sans-serif;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	/* Sections */
	.l-section {
		padding: 72px 24px;
	}
	.l-section-tinted {
		background: var(--surface-soft);
	}
	.l-section-head {
		max-width: 1120px;
		margin: 0 auto 36px;
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
	}
	.l-section-head-center {
		flex-direction: column;
		align-items: center;
		text-align: center;
		max-width: 640px;
	}
	.l-eyebrow {
		font: 700 11px/1 'Inter', sans-serif;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent-emerald);
	}
	.l-h2 {
		font: 600 30px/1.2 'Plus Jakarta Sans', sans-serif;
		letter-spacing: -0.015em;
		color: var(--ink);
		margin: 8px 0 0;
	}
	.l-section-sub {
		font: 400 15px/1.6 'Inter', sans-serif;
		color: var(--text-muted);
		max-width: 380px;
		margin: 8px 0 0;
	}

	.l-feature-grid {
		max-width: 1120px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 18px;
	}
	.l-feature-card {
		background: var(--card);
		border-radius: 14px;
		padding: 22px;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
	}
	.l-feature-icon {
		width: 40px;
		height: 40px;
		border-radius: 10px;
		background: var(--surface-soft);
		display: grid;
		place-items: center;
		color: var(--ink);
		margin-bottom: 14px;
	}
	.l-feature-card h3 {
		font: 600 15px 'Plus Jakarta Sans', sans-serif;
		color: var(--ink);
		margin: 0 0 6px;
	}
	.l-feature-card p {
		font: 400 13.5px/1.55 'Inter', sans-serif;
		color: var(--text-muted);
		margin: 0;
	}

	.l-steps-grid {
		max-width: 1120px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 18px;
	}
	.l-step-card {
		background: var(--card);
		border-radius: 14px;
		padding: 22px;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
	}
	.l-step-num {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: var(--surface-soft);
		display: grid;
		place-items: center;
		font: 600 14px 'Plus Jakarta Sans', sans-serif;
		color: var(--ink);
		margin-bottom: 12px;
	}
	.l-step-card h3 {
		font: 600 15px 'Plus Jakarta Sans', sans-serif;
		color: var(--ink);
		margin: 0 0 6px;
	}
	.l-step-card p {
		font: 400 13.5px/1.55 'Inter', sans-serif;
		color: var(--text-muted);
		margin: 0;
	}

	.l-dev-grid {
		max-width: 1120px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 5fr 7fr;
		gap: 40px;
		align-items: center;
	}
	.l-dev-checks {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-top: 24px;
	}
	.l-dev-checks > div {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}
	.l-dev-checks :global(svg) {
		color: var(--accent-emerald);
		flex: none;
		margin-top: 2px;
	}
	.l-dev-check-title {
		font: 600 14px 'Inter', sans-serif;
		color: var(--ink);
		margin: 0 0 3px;
	}
	.l-dev-check-body {
		font: 400 13px/1.5 'Inter', sans-serif;
		color: var(--text-muted);
		margin: 0;
	}

	.l-terminal {
		border-radius: 14px;
		background: var(--surface-dark);
		color: #fff;
		overflow: hidden;
		box-shadow: 0 20px 44px rgba(15, 23, 42, 0.2);
	}
	.l-terminal-bar {
		padding: 10px 16px;
		background: rgba(255, 255, 255, 0.05);
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.l-terminal-dots {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.l-terminal-dots span {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
	}
	.l-terminal-dots span:nth-child(1) {
		background: var(--stamp-rust);
	}
	.l-terminal-dots span:nth-child(2) {
		background: var(--accent-amber);
	}
	.l-terminal-dots span:nth-child(3) {
		background: var(--accent-emerald);
	}
	.l-terminal-path {
		margin-left: 8px;
		font: 500 11px 'JetBrains Mono', monospace;
		color: rgba(255, 255, 255, 0.5);
		border-radius: 0;
		background: none;
		width: auto;
		height: auto;
		white-space: nowrap;
	}
	.l-terminal-dots {
		flex-wrap: nowrap;
	}
	.l-terminal-copy {
		display: flex;
		align-items: center;
		gap: 6px;
		background: transparent;
		border: 0;
		color: rgba(255, 255, 255, 0.55);
		font: 500 11px 'JetBrains Mono', monospace;
		cursor: pointer;
	}
	.l-terminal-copy:hover {
		color: #fff;
	}
	.l-terminal-body {
		margin: 0;
		padding: 20px;
		font: 400 12.5px/1.7 'JetBrains Mono', monospace;
		color: rgba(255, 255, 255, 0.82);
		overflow-x: auto;
		white-space: pre;
	}
	.l-terminal-footer {
		padding: 10px 20px;
		background: rgba(255, 255, 255, 0.04);
		display: flex;
		align-items: center;
		gap: 8px;
		font: 500 11px 'JetBrains Mono', monospace;
		color: var(--accent-emerald);
	}

	.l-cta-card {
		max-width: 800px;
		margin: 0 auto;
		border-radius: 20px;
		background: linear-gradient(160deg, var(--ink-2), var(--surface-dark));
		color: #fff;
		padding: 56px 40px;
		text-align: center;
	}
	.l-eyebrow-light {
		color: var(--accent-emerald);
	}
	.l-h2-light {
		color: #fff;
		max-width: 560px;
		margin: 10px auto 0;
	}
	.l-cta-sub {
		font: 400 16px/1.6 'Inter', sans-serif;
		color: rgba(255, 255, 255, 0.65);
		max-width: 480px;
		margin: 16px auto 28px;
	}
	.l-cta-btn {
		height: 46px;
		padding: 0 26px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: #fff;
		color: var(--ink);
		font: 600 14px 'Inter', sans-serif;
	}
	.l-cta-btn:hover {
		background: var(--surface-soft);
	}

	/* Footer */
	.l-footer {
		border-top: 1px solid var(--line);
		background: var(--surface-soft);
		padding: 48px 24px 28px;
	}
	.l-footer-grid {
		max-width: 1120px;
		margin: 0 auto;
		display: grid;
		grid-template-columns: 1.6fr 1fr 1fr 1fr;
		gap: 32px;
		padding-bottom: 32px;
	}
	.l-footer-brand p {
		margin: 12px 0 0;
		font: 400 13px/1.6 'Inter', sans-serif;
		color: var(--text-muted);
		max-width: 260px;
	}
	.l-footer-col {
		display: flex;
		flex-direction: column;
		gap: 9px;
	}
	.l-footer-heading {
		font: 700 11px/1 'Inter', sans-serif;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink);
		margin-bottom: 4px;
	}
	.l-footer-col a {
		font: 400 13px 'Inter', sans-serif;
		color: var(--text-muted);
	}
	.l-footer-col a:hover {
		color: var(--ink);
		text-decoration: none;
	}
	.l-footer-trust {
		display: flex;
		align-items: center;
		gap: 8px;
		font: 400 13px 'Inter', sans-serif;
		color: var(--text-muted);
	}
	.l-footer-trust :global(svg) {
		color: var(--accent-emerald);
	}
	.l-footer-bottom {
		max-width: 1120px;
		margin: 0 auto;
		padding-top: 20px;
		border-top: 1px solid var(--line);
		font: 400 12px 'Inter', sans-serif;
		color: var(--text-muted);
	}

	/* Responsive */
	@media (max-width: 900px) {
		.l-nav {
			display: none;
		}
		.l-mockups {
			grid-template-columns: 1fr;
		}
		.l-dev-grid {
			grid-template-columns: 1fr;
			gap: 28px;
		}
		.l-feature-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.l-steps-grid {
			grid-template-columns: repeat(2, 1fr);
		}
		.l-footer-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (max-width: 640px) {
		.l-header-inner {
			padding: 0 16px;
		}
		.l-header-cta .btn-ghost {
			display: none;
		}
		.l-hero {
			padding: 36px 16px 32px;
		}
		.l-hero-title {
			font-size: 30px;
			line-height: 1.2;
		}
		.l-hero-sub {
			font-size: 15px;
		}
		.l-hero-cta {
			flex-direction: column;
			align-items: stretch;
		}
		.l-hero-btn,
		.l-text-link {
			width: 100%;
			justify-content: center;
		}
		.l-pill-hide-sm {
			display: none;
		}
		.l-trust-row {
			gap: 14px;
		}
		.l-section {
			padding: 48px 16px;
		}
		.l-stats-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 24px 16px;
		}
		.l-feature-grid,
		.l-steps-grid {
			grid-template-columns: 1fr;
		}
		.l-h2 {
			font-size: 24px;
		}
		.l-cta-card {
			padding: 40px 22px;
		}
		.l-footer-grid {
			grid-template-columns: 1fr;
			gap: 24px;
		}
	}
</style>
