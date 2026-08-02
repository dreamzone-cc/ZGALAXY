<script lang="ts">
	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/logo.svg" />
	<link rel="apple-touch-icon" href="/logo.svg" />
</svelte:head>

{@render children()}
