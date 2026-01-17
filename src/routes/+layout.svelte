<script lang="ts">
	import favicon from '$lib/assets/favicon.png';
	import { onMount } from 'svelte';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';

	let { children } = $props();

	onMount(() => {
		injectAnalytics();
		injectSpeedInsights();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
