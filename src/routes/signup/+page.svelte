<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { getAuth0Client } from "$lib/client/auth0";

	let error = "";
	let loading = false;

	const startSignup = async () => {
		error = "";
		loading = true;
		try {
			const client = await getAuth0Client();
			await client.loginWithRedirect({
				authorizationParams: {
					screen_hint: "signup"
				}
			});
		} catch (err) {
			error = err instanceof Error ? err.message : "Signup failed.";
			loading = false;
		}
	};

	onMount(async () => {
		const resetLoading = () => {
			loading = false;
		};
		window.addEventListener("pageshow", resetLoading);
		window.addEventListener("focus", resetLoading);
		try {
			const client = await getAuth0Client();
			if (await client.isAuthenticated()) {
				await goto("/");
			}
		} catch (err) {
			error = err instanceof Error ? err.message : "Auth0 configuration error.";
		}
		return () => {
			window.removeEventListener("pageshow", resetLoading);
			window.removeEventListener("focus", resetLoading);
		};
	});
</script>

<svelte:head>
	<title>Sign up | fbsts</title>
</svelte:head>

<section class="auth">
	<div class="card">
		<p class="eyebrow">FBSTS access</p>
		<h1>Create account</h1>
		<p class="subtitle">Sign up to access fbsts.</p>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<div class="actions">
			<button type="button" on:click={startSignup} disabled={loading}>
				{loading ? "Redirecting..." : "Create account with Auth0"}
			</button>
		</div>

		<p class="footer">
			Already have an account?
			<a href="/login">Log in</a>
		</p>
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

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.25em;
		font-size: 11px;
		font-weight: 600;
		color: #6c5f52;
		margin: 0;
	}

	h1 {
		font-family: "Fraunces", "Georgia", serif;
		font-size: 2rem;
		margin: 0;
	}

	.subtitle {
		margin: 0 0 10px;
		color: #4b3e34;
	}

	.actions {
		display: grid;
		gap: 10px;
	}

	button {
		border: none;
		border-radius: 999px;
		padding: 12px;
		background: #0f6b4f;
		color: #f7f4ed;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 10px 24px rgba(15, 107, 79, 0.2);
		transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
	}

	button:hover {
		transform: translateY(-1px);
		filter: brightness(1.03);
		box-shadow: 0 14px 28px rgba(15, 107, 79, 0.25);
	}

	.error {
		margin: 0 0 12px;
		color: #9b3a25;
		font-weight: 600;
	}

	.footer {
		margin: 18px 0 0;
		font-size: 0.9rem;
		color: #6c5f52;
	}

	.hint {
		margin: 0;
		font-size: 0.85rem;
		color: #6c5f52;
	}

	.footer a {
		color: inherit;
	}
</style>
