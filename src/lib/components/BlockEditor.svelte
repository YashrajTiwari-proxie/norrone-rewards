<script lang="ts">
	import Icon from './Icon.svelte';
	import { BLOCK_TYPES, defaultBlockFor, type EmailBlock } from '../../../convex/lib/emailBlocks';

	let {
		blocks = $bindable(),
		isDraft,
		rewards,
		coupons
	}: {
		blocks: EmailBlock[];
		isDraft: boolean;
		/** Only an org campaign has a reward/coupon catalog to pick from — omit to hide those block types entirely. */
		rewards?: { _id: string; name: string }[];
		coupons?: { _id: string; name: string }[];
	} = $props();

	const CONTENT_TYPES = ['heading', 'paragraph', 'image', 'button', 'divider', 'spacer'] as const;
	const LOYALTY_TYPES = ['reward', 'coupon'] as const;

	const blockMeta: Record<(typeof BLOCK_TYPES)[number], { label: string; icon: string }> = {
		heading: { label: 'Heading', icon: 'type' },
		paragraph: { label: 'Paragraph', icon: 'alignLeft' },
		image: { label: 'Image', icon: 'image' },
		button: { label: 'Button', icon: 'link' },
		divider: { label: 'Divider', icon: 'minus' },
		spacer: { label: 'Spacer', icon: 'layers' },
		reward: { label: 'Reward', icon: 'gift' },
		coupon: { label: 'Coupon', icon: 'ticket' }
	};

	function addBlock(type: (typeof BLOCK_TYPES)[number]) {
		blocks = [...blocks, defaultBlockFor(type)];
	}
	function removeBlock(i: number) {
		blocks = blocks.filter((_, idx) => idx !== i);
	}

	// Native HTML5 drag-and-drop — draggingIndex is the block being moved,
	// dragOverIndex is the current drop target (drives the insertion-line
	// indicator). Dropping reorders the array in place; no library needed
	// for a list this small.
	let draggingIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	function onDragStart(event: DragEvent, i: number) {
		draggingIndex = i;
		event.dataTransfer?.setData('text/plain', String(i));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}
	function onDragOver(event: DragEvent, i: number) {
		if (draggingIndex === null) return;
		event.preventDefault();
		dragOverIndex = i;
	}
	function onDrop(event: DragEvent, i: number) {
		event.preventDefault();
		if (draggingIndex === null || draggingIndex === i) {
			draggingIndex = null;
			dragOverIndex = null;
			return;
		}
		const next = [...blocks];
		const [moved] = next.splice(draggingIndex, 1);
		next.splice(draggingIndex < i ? i - 1 : i, 0, moved);
		blocks = next;
		draggingIndex = null;
		dragOverIndex = null;
	}
	function onDragEnd() {
		draggingIndex = null;
		dragOverIndex = null;
	}
</script>

<div style="display:flex;flex-direction:column;gap:8px">
	{#each blocks as block, i (block)}
		<div
			role="group"
			ondragover={(e) => onDragOver(e, i)}
			ondrop={(e) => onDrop(e, i)}
			style="position:relative"
		>
			{#if dragOverIndex === i && draggingIndex !== null && draggingIndex !== i}
				<div style="position:absolute;top:-5px;left:8px;right:8px;height:2px;background:var(--ink);border-radius:1px;z-index:1"></div>
			{/if}
			<div
				class="card block-card"
				style="padding:12px 14px;display:flex;flex-direction:column;gap:10px;opacity:{draggingIndex === i ? 0.4 : 1}"
			>
				<div style="display:flex;align-items:center;gap:8px">
					{#if isDraft}
						<span
							role="button"
							tabindex="0"
							aria-label="Drag to reorder"
							draggable="true"
							ondragstart={(e) => onDragStart(e, i)}
							ondragend={onDragEnd}
							title="Drag to reorder"
							style="display:flex;align-items:center;color:var(--text-muted);cursor:grab;flex:none;touch-action:none"
						>
							<Icon name="grip" size={14} />
						</span>
					{/if}
					<span style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--paper-2, #f4f1ec);color:var(--text-muted);flex:none">
						<Icon name={blockMeta[block.type].icon} size={12} />
					</span>
					<span style="flex:1;font:500 11px 'Geist', sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)">
						{blockMeta[block.type].label}
					</span>
					{#if isDraft}
						<button
							type="button"
							class="btn btn-ghost"
							style="padding:3px 7px;color:var(--stamp-rust, #b5482f)"
							onclick={() => removeBlock(i)}
							title="Remove block"
						>
							<Icon name="trash" size={12} />
						</button>
					{/if}
				</div>

				{#if block.type === 'heading' || block.type === 'paragraph'}
					<textarea
						bind:value={block.text}
						disabled={!isDraft}
						rows={block.type === 'heading' ? 1 : 3}
						class="input"
						style="font-family:'Geist',sans-serif;resize:vertical"
					></textarea>
				{:else if block.type === 'image'}
					<input type="url" bind:value={block.url} disabled={!isDraft} class="input" placeholder="Image URL" />
					<input type="text" bind:value={block.alt} disabled={!isDraft} class="input" placeholder="Alt text" />
				{:else if block.type === 'button'}
					<input type="text" bind:value={block.label} disabled={!isDraft} class="input" placeholder="Button label" />
					<input type="url" bind:value={block.url} disabled={!isDraft} class="input" placeholder="Link URL" />
				{:else if block.type === 'spacer'}
					<input type="number" bind:value={block.height} disabled={!isDraft} min="0" class="input" style="width:120px" />
				{:else if block.type === 'reward'}
					<select bind:value={block.rewardId} disabled={!isDraft} class="input">
						<option value="">Choose a reward…</option>
						{#each rewards ?? [] as r (r._id)}
							<option value={r._id}>{r.name}</option>
						{/each}
					</select>
				{:else if block.type === 'coupon'}
					<select bind:value={block.couponDefinitionId} disabled={!isDraft} class="input">
						<option value="">Choose a coupon…</option>
						{#each coupons ?? [] as c (c._id)}
							<option value={c._id}>{c.name}</option>
						{/each}
					</select>
					<div style="font:400 12px/1.4 'Geist', sans-serif;color:var(--text-muted)">
						Each recipient gets their own personal code, minted when the campaign sends.
					</div>
				{/if}
			</div>
		</div>
	{/each}

	{#if blocks.length === 0}
		<div class="card" style="padding:28px 16px;text-align:center;font:400 13px 'Geist', sans-serif;color:var(--text-muted);border-style:dashed">
			No blocks yet — add one below.
		</div>
	{/if}

	{#if isDraft}
		<div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
			<div style="display:flex;flex-wrap:wrap;gap:6px">
				{#each CONTENT_TYPES as t (t)}
					<button type="button" class="btn btn-outline" style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:6px" onclick={() => addBlock(t)}>
						<Icon name={blockMeta[t].icon} size={12} />
						{blockMeta[t].label}
					</button>
				{/each}
			</div>
			{#if rewards || coupons}
				<div style="display:flex;flex-wrap:wrap;gap:6px">
					{#each LOYALTY_TYPES as t (t)}
						<button type="button" class="btn btn-outline" style="padding:6px 12px;font-size:12px;display:flex;align-items:center;gap:6px" onclick={() => addBlock(t)}>
							<Icon name={blockMeta[t].icon} size={12} />
							{blockMeta[t].label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.block-card {
		transition: opacity 0.12s ease;
	}
	.block-card:has(textarea:focus, input:focus, select:focus) {
		border-color: var(--ink-3, #b7b3a8);
	}
</style>
