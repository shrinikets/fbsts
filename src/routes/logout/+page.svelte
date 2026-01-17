<script lang="ts">
	import { onMount } from "svelte";
	import { getAuth0Client } from "$lib/client/auth0";

	onMount(async () => {
		const client = await getAuth0Client();
		await client.logout({
			logoutParams: {
				returnTo: `${window.location.origin}/login`
			}
		});
	});
</script>

<svelte:head>
	<title>Logging out | fbsts</title>
</svelte:head>

<section class="auth">
	<div class="card">
		<h1>Logging you out...</h1>
		<p class="subtitle">Closing your Auth0 session.</p>
	</div>
</section>

<style>
	@import url("https://fonts.googleapis.com/css2?family=Fraunces:wght@600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap");

	:global(body) {
		margin: 0;
		font-family: "Space Grotesk", "Segoe UI", sans-serif;
		color: #1e1a17;
		background: #f4efe7;
	}

	.auth {
		min-height: 100vh;
		display: grid;
		place-items: center;
		padding: 64px 8vw 72px;
		background:
			radial-gradient(circle at 12% 18%, rgba(255, 214, 153, 0.45), transparent 45%),
			radial-gradient(circle at 88% 6%, rgba(110, 177, 155, 0.35), transparent 40%),
			linear-gradient(140deg, #f6f0e6 0%, #f3e7d9 40%, #efe3cf 100%);
	}

	.card {
		width: min(440px, 100%);
		background: #fbf8f2;
		border: 1px solid #e2d7c7;
		border-radius: 22px;
		padding: 28px;
		box-shadow: 0 20px 40px rgba(46, 35, 28, 0.12);
		display: grid;
		gap: 12px;
	}

	h1 {
		font-family: "Fraunces", "Georgia", serif;
		font-size: 2rem;
		margin: 0;
	}

	.subtitle {
		margin: 0;
		color: #4b3e34;
	}
</style>
