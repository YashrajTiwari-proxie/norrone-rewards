<script lang="ts">
	import { navigating } from '$app/state';

	let visible = $derived(navigating.to !== null);
</script>

{#if visible}
	<div class="nav-progress" aria-hidden="true">
		<div class="nav-progress-bar"></div>
	</div>
{/if}

<style>
	.nav-progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 3px;
		z-index: 100;
		background: transparent;
		overflow: hidden;
	}
	.nav-progress-bar {
		height: 100%;
		width: 40%;
		background: var(--stamp-green, #2f6f4e);
		animation: nav-progress-slide 0.9s ease-in-out infinite;
	}
	@keyframes nav-progress-slide {
		0% {
			transform: translateX(-100%);
		}
		50% {
			transform: translateX(60%);
		}
		100% {
			transform: translateX(250%);
		}
	}
</style>
