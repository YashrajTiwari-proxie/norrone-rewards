<script lang="ts">
	import '$lib/styles/tokens.css';
</script>

<!--
	Better Auth can send real reset emails via emailAndPassword.sendResetPassword
	(convex/auth.ts), but no transactional email provider is wired up yet —
	that's a separate decision (Resend/Postmark/etc.) than the Convex
	migration itself. Placeholder until that's chosen.
-->
<div style="min-height:100vh;background:var(--paper);display:grid;place-items:center;padding:40px;font-family:'IBM Plex Sans',sans-serif">
	<div style="width:100%;max-width:392px">
		<div class="card" style="padding:32px">
			<div style="font:600 21px/1.2 'IBM Plex Sans',sans-serif;color:var(--ink);letter-spacing:-.01em">
				Password reset
			</div>
			<div style="margin-top:12px;font:400 14px/1.5 'IBM Plex Sans',sans-serif;color:var(--text-muted)">
				Self-serve password reset isn't set up yet — contact an owner at your organization to have your
				password reset, or ask a platform admin for help.
			</div>
			<div style="margin-top:18px;text-align:center;font:400 13px 'IBM Plex Sans',sans-serif">
				<a href="/login">Back to sign in</a>
			</div>
		</div>
	</div>
</div>
