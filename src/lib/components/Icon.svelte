<script lang="ts">
	/**
	 * Inline SVG icon set (lucide-style paths, hand-picked — avoids pulling
	 * in an icon library dependency for ~25 icons). viewBox is always
	 * 0 0 24 24; stroke="currentColor" so color follows the surrounding text.
	 */
	const paths: Record<string, string> = {
		overview:
			'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
		users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
		card: 'M2 6a2 2 0 012-2h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM2 10h20',
		layers: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
		coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v10M9 9.5c0-1 1-1.5 3-1.5s3 .8 3 2-1.2 1.6-3 2-3 .8-3 2 1 2 3 2 3-.5 3-1.5',
		gift: 'M20 12v10H4V12M2 7h20v5H2V7zM12 22V7M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z',
		ticket:
			'M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8zM9 6v12',
		store: 'M3 9l1-6h16l1 6M3 9v11h18V9M3 9h18M9 21v-6h6v6',
		key: 'M15 7a4 4 0 11-8.62 2.38L2 14v3h3v-2h2v-2h2l1.62-1.62A4 4 0 0115 7z',
		book: 'M4 4.5A2.5 2.5 0 016.5 2H20v18H6.5A2.5 2.5 0 014 17.5v-13zM4 17.5A2.5 2.5 0 016.5 20H20',
		wallet:
			'M2 7a2 2 0 012-2h13a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7zM17 12h.01M14 7V5a2 2 0 00-2-2H5a2 2 0 00-2 2v1',
		staff: 'M20 8v6M23 11h-6M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z',
		chevronLeft: 'M15 18l-6-6 6-6',
		chevronRight: 'M9 18l6-6-6-6',
		chevronDown: 'M6 9l6 6 6-6',
		edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
		close: 'M18 6L6 18M6 6l12 12',
		copy: 'M20 9H11a2 2 0 00-2 2v9a2 2 0 002 2h9a2 2 0 002-2v-9a2 2 0 00-2-2zM5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1',
		check: 'M20 6L9 17l-5-5',
		plus: 'M12 5v14M5 12h14',
		trash: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z',
		search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
		menu: 'M3 12h18M3 6h18M3 18h18',
		alert:
			'M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01',
		logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9'
	};

	let { name, size = 16 }: { name: keyof typeof paths | string; size?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	style="flex:none;display:block"
>
	<path d={paths[name] ?? ''} />
</svg>
