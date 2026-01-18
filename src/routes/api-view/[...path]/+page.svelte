<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { dev } from "$app/environment";
	import { env } from "$env/dynamic/public";
	import { getAccessToken, isAuthenticated } from "$lib/client/auth0";

	let loading = true;
	let error = "";
	let payload = "";
	let requestPath = "";
	let copied = false;

	const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";

	onMount(async () => {
		requestPath = `${window.location.pathname.replace("/api-view", "/api")}${
			window.location.search
		}`;

		if (!authBypass) {
			const authed = await isAuthenticated();
			if (!authed) {
				await goto("/login");
				return;
			}
		}

		try {
			const headers = new Headers();
			if (!authBypass) {
				const token = await getAccessToken();
				headers.set("Authorization", `Bearer ${token}`);
			}
			const response = await fetch(requestPath, { headers });
			if (!response.ok) {
				const message = await response.text();
				error = message || response.statusText;
				return;
			}
			const data = await response.json();
			payload = JSON.stringify(data, null, 2);
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load API response.";
		} finally {
			loading = false;
		}
	});

	const copyPayload = async () => {
		if (!payload) {
			return;
		}
		try {
			await navigator.clipboard.writeText(payload);
			copied = true;
			window.setTimeout(() => {
				copied = false;
			}, 1400);
		} catch (err) {
			error = err instanceof Error ? err.message : "Copy failed.";
		}
	};
</script>

<svelte:head>
	<title>API response | fbsts</title>
</svelte:head>

<section class="page">
	<div class="card">
		<header>
			<h1>API response</h1>
			<p class="path">{requestPath}</p>
		</header>

		{#if loading}
			<p class="muted">Loading response...</p>
		{:else if error}
			<p class="error">{error}</p>
			<a class="back" href="/">Back to dashboard</a>
		{:else}
			<button class="copy-button" type="button" on:click={copyPayload} aria-label="Copy API response">
				{#if copied}
					<svg class="copy-icon check" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path
							d="M6.4 11.2 3.6 8.4l1.2-1.2 1.6 1.6 4.4-4.4 1.2 1.2-5.6 5.6Z"
						/>
					</svg>
				{:else}
					<svg class="copy-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path
							d="M10 1H4a2 2 0 0 0-2 2v6h2V3h6V1Zm2 3H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 9H7V6h5v7Z"
						/>
					</svg>
				{/if}
			</button>
			<pre>{payload}</pre>
			<a class="back" href="/">Back to dashboard</a>
		{/if}
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

	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	.page {
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
		width: min(920px, 100%);
		background: #fbf8f2;
		border: 1px solid #e2d7c7;
		border-radius: 22px;
		padding: 28px;
		box-shadow: 0 20px 40px rgba(46, 35, 28, 0.12);
		display: grid;
		gap: 16px;
		position: relative;
	}

	h1 {
		font-family: "Fraunces", "Georgia", serif;
		margin: 0 0 6px;
	}

	.path {
		margin: 0;
		color: #6c5f52;
		font-size: 0.9rem;
		word-break: break-all;
	}

	pre {
		background: #f5eee5;
		border: 1px solid #e5d8c8;
		border-radius: 14px;
		padding: 16px;
		margin: 0;
		overflow: auto;
		max-height: 70vh;
		font-size: 0.85rem;
		line-height: 1.5;
	}

	.copy-button {
		position: absolute;
		top: 20px;
		right: 20px;
		border: 1px solid #d2c5b8;
		background: #fdfbf7;
		border-radius: 12px;
		padding: 8px;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #1e1a17;
		transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
	}

	.copy-button:hover {
		background: #f1e8dc;
		border-color: #cbbca9;
		transform: translateY(-1px);
	}

	.copy-icon {
		width: 18px;
		height: 18px;
		fill: currentColor;
		transition: transform 0.2s ease, opacity 0.2s ease;
	}

	.copy-icon.check {
		transform: scale(1.05);
	}

	.error {
		color: #9b3a25;
		font-weight: 600;
	}

	.muted {
		color: #6c5f52;
	}

	.back {
		color: #6c5f52;
	}
</style>
