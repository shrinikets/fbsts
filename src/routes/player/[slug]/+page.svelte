<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { env } from "$env/dynamic/public";
	import { dev } from "$app/environment";
	import { getAccessToken, isAuthenticated } from "$lib/client/auth0";
	import { statDescription, statLabel } from "$lib/stats-ui";

	type StatMode = "total" | "per-game" | "per-90";
	type PlayerTotals = Record<string, number | null>;
	type PlayerByTeamRow = {
		team: string;
		appearances: number | null;
		goals: number | null;
		assists: number | null;
		minutes: number | null;
	};
	type PlayerByTeamView = PlayerByTeamRow & {
		scaled: Record<string, number | null>;
	};
	type PlayerPayload = {
		player: string;
		mode: StatMode;
		totals: PlayerTotals;
		byTeam: Record<string, unknown>[];
	};

	const playerCache = new Map<string, PlayerPayload>();
	const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";
	const apiBase = env.PUBLIC_API_BASE?.replace(/\/+$/, "") ?? "";

	let authReady = false;
	let authError = "";
	let loading = false;
	let error = "";
	let playerName = "";
	let playerData: PlayerPayload | null = null;
	let playerTotalsView: PlayerTotals = {};
	let byTeamView: PlayerByTeamView[] = [];
	let mode: StatMode = "total";
	let lastSlug = "";
	let slug = "";

	$: slug = $page.params.slug ?? "";
	$: {
		const nextMode = parseMode($page.url.searchParams.get("mode"));
		if (nextMode !== mode) {
			mode = nextMode;
		}
	}

	const parseMode = (value: string | null): StatMode => {
		if (value === "per-game" || value === "per-90" || value === "total") {
			return value;
		}
		return "total";
	};

	const normalizeText = (value: string) =>
		value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase();

	const toSlug = (value: string) =>
		normalizeText(value)
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-+|-+$)/g, "");

	const formatValue = (value: number | null) =>
		value === null || value === undefined
			? "-"
			: Number.isInteger(value)
				? value.toLocaleString()
				: value.toLocaleString(undefined, { maximumFractionDigits: 2 });

	const readStat = (totals: PlayerTotals, keys: string[], fallback = 0) => {
		for (const key of keys) {
			const value = totals[key];
			if (value !== null && value !== undefined) {
				return value;
			}
		}
		return fallback;
	};

	const sortedEntries = (totals: Record<string, number | null>) =>
		Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));

	const normalizeByTeam = (rows: Record<string, unknown>[]): PlayerByTeamRow[] =>
		rows.map((row) => ({
			team: typeof row.team === "string" ? row.team : "Unknown",
			appearances: typeof row.appearances === "number" ? row.appearances : null,
			goals: typeof row.goals === "number" ? row.goals : null,
			assists: typeof row.assists === "number" ? row.assists : null,
			minutes: typeof row.minutes === "number" ? row.minutes : null
		}));

	const pickNumber = (totals: Record<string, number | null>, keys: string[]) => {
		for (const key of keys) {
			const value = totals[key];
			if (typeof value === "number" && Number.isFinite(value)) {
				return value;
			}
		}
		return null;
	};

	const scaleTotals = (
		totals: Record<string, number | null>,
		currentMode: StatMode,
		perGameDenom: number | null,
		per90Minutes: number | null,
		exclude: Set<string>
	) => {
		if (currentMode === "total") {
			return totals;
		}

		const output: Record<string, number | null> = {};
		const perGame = perGameDenom && perGameDenom > 0 ? perGameDenom : null;
		const per90Base =
			per90Minutes && per90Minutes > 0 ? per90Minutes : perGame ? perGame * 90 : null;

		for (const [key, value] of Object.entries(totals)) {
			if (exclude.has(key) || value === null || value === undefined) {
				output[key] = value;
				continue;
			}
			if (typeof value !== "number" || Number.isNaN(value)) {
				output[key] = value;
				continue;
			}
			if (currentMode === "per-game") {
				output[key] = perGame ? value / perGame : value;
				continue;
			}
			if (currentMode === "per-90") {
				output[key] = per90Base ? (value / per90Base) * 90 : value;
				continue;
			}
			output[key] = value;
		}

		return output;
	};

	const readError = async (response: Response) => {
		try {
			const data = await response.json();
			return data?.message || response.statusText;
		} catch {
			return response.statusText;
		}
	};

	const goBack = () => {
		if (typeof window !== "undefined" && window.history.length > 1) {
			window.history.back();
			return;
		}
		void goto("/");
	};

	const authFetch = async (input: RequestInfo, init: RequestInit = {}) => {
		const target =
			typeof input === "string" && input.startsWith("/api") ? `${apiBase}${input}` : input;
		if (authBypass) {
			return fetch(target, init);
		}
		const token = await getAccessToken();
		const headers = new Headers(init.headers ?? {});
		headers.set("Authorization", `Bearer ${token}`);
		return fetch(target, { ...init, headers });
	};

	const updateMode = async (event: Event) => {
		const value = (event.target as HTMLSelectElement).value as StatMode;
		mode = value;
		if (typeof window === "undefined") {
			return;
		}
		const url = new URL(window.location.href);
		if (value === "total") {
			url.searchParams.delete("mode");
		} else {
			url.searchParams.set("mode", value);
		}
		await goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
	};

	const loadPlayer = async () => {
		if (!slug) {
			error = "Missing player slug.";
			return;
		}
		if (!authReady) {
			error = "Please log in to load player stats.";
			return;
		}
		const cached = playerCache.get(slug);
		if (cached) {
			playerData = cached;
			playerName = cached.player;
			return;
		}
		loading = true;
		error = "";
		playerName = "";
		playerData = null;
		try {
			const response = await authFetch(`/api/player/${encodeURIComponent(slug)}`);
			if (!response.ok) {
				error = await readError(response);
				return;
			}
			const payload = (await response.json()) as PlayerPayload;
			playerCache.set(slug, payload);
			playerData = payload;
			playerName = payload.player;
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load player data.";
		} finally {
			loading = false;
		}
	};

	onMount(() => {
		const bootstrap = async () => {
			authError = "";
			authReady = false;
			if (authBypass) {
				authReady = true;
				return;
			}
			try {
				const authed = await isAuthenticated();
				if (!authed) {
					await goto("/login");
					return;
				}
				authReady = true;
			} catch (err) {
				authError = err instanceof Error ? err.message : "Auth check failed.";
			}
		};
		void bootstrap();
	});

	$: playerName = playerData?.player ?? "";

	$: {
		if (playerData) {
			const appearances = pickNumber(playerData.totals ?? {}, ["appearances"]);
			const minutes = pickNumber(playerData.totals ?? {}, ["min", "minutes"]);
			const exclude = new Set(["appearances", "min", "minutes"]);
			playerTotalsView = scaleTotals(
				playerData.totals ?? {},
				mode,
				appearances,
				minutes,
				exclude
			);
			byTeamView = normalizeByTeam(playerData.byTeam ?? []).map((row) => {
				const scaled = scaleTotals(
					{
						appearances: row.appearances,
						minutes: row.minutes,
						goals: row.goals,
						assists: row.assists
					},
					mode,
					row.appearances ?? null,
					row.minutes ?? null,
					new Set(["appearances", "minutes"])
				);
				return { ...row, scaled };
			});
		} else {
			playerTotalsView = {};
			byTeamView = [];
		}
	}

	$: {
		if (authReady && slug) {
			if (slug !== lastSlug) {
				lastSlug = slug;
				void loadPlayer();
			}
		}
	}
</script>

<svelte:head>
	<title>{playerName ? `${playerName} | fbsts` : "Player | fbsts"}</title>
</svelte:head>

{#if !authReady}
	<div class="auth-gate">
		<p>Checking your session...</p>
		{#if authError}
			<p class="error">{authError}</p>
		{/if}
	</div>
{:else}
	<div class="page">
		<div class="top-bar">
			<button class="ghost" type="button" on:click={goBack}>Back</button>
			<a class="ghost" href="/logout">Log out</a>
		</div>

		{#if loading && !playerData}
			<div class="loading-overlay" aria-live="polite">
				<div class="loader">
					<span class="spinner" aria-hidden="true"></span>
					<span>Loading player...</span>
				</div>
			</div>
		{/if}

		<header class="hero reveal" style="--delay: 0s">
			<p class="eyebrow">Player dashboard</p>
			<h1>{playerName || (loading ? "Loading player..." : "Player")}</h1>
			<div class="hero-actions">
				<label class="mode-select">
					Mode
					<select value={mode} on:change={updateMode}>
						<option value="total">Total</option>
						<option value="per-game">Per game</option>
						<option value="per-90">Per 90</option>
					</select>
				</label>
				<div class="slug-pill">/player/{slug}</div>
			</div>
		</header>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<section class="grid">
			<article class="card reveal" style="--delay: 0.1s">
				<header>
					<h2>Summary</h2>
				</header>
				{#if loading}
					<p class="muted">Loading player stats...</p>
				{:else if Object.keys(playerTotalsView).length === 0}
					<p class="muted">No player totals available yet.</p>
				{:else}
					<div class="stats-grid">
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("performance_gls")}>
									{statLabel("performance_gls")}
								</abbr>
							</span>
							<strong>
								{formatValue(readStat(playerTotalsView, ["performance_gls", "goals"]))}
							</strong>
						</div>
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("performance_ast")}>
									{statLabel("performance_ast")}
								</abbr>
							</span>
							<strong>
								{formatValue(readStat(playerTotalsView, ["performance_ast", "assists"]))}
							</strong>
						</div>
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("min")}>
									{statLabel("min")}
								</abbr>
							</span>
							<strong>{formatValue(readStat(playerTotalsView, ["min", "minutes"]))}</strong>
						</div>
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("appearances")}>
									{statLabel("appearances")}
								</abbr>
							</span>
							<strong>{formatValue(readStat(playerTotalsView, ["appearances"]))}</strong>
						</div>
					</div>
				{/if}
			</article>

			<article class="card reveal" style="--delay: 0.2s">
				<header>
					<h2>By team</h2>
				</header>
				{#if loading}
					<p class="muted">Loading team splits...</p>
				{:else if byTeamView.length === 0}
					<p class="muted">No team split data available yet.</p>
				{:else}
					<ul class="list">
						{#each byTeamView as row}
							<li>
								<a class="team-link" href={`/team/${encodeURIComponent(toSlug(row.team))}`}>
									{row.team}
								</a>
								<span class="stat-pair">
									{formatValue(row.scaled.goals ?? row.goals)} G,
									{formatValue(row.scaled.assists ?? row.assists)} A
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</article>

			<article class="card reveal" style="--delay: 0.25s">
				<header>
					<h2>All stats</h2>
				</header>
				{#if loading}
					<p class="muted">Loading full stat list...</p>
				{:else if Object.keys(playerTotalsView).length === 0}
					<p class="muted">No stats found yet.</p>
				{:else}
					<ul class="list stats-list">
						{#each sortedEntries(playerTotalsView) as [key, value]}
							<li>
								<span>
									<abbr class="stat-label" title={statDescription(key)}>
										{statLabel(key)}
									</abbr>
								</span>
								<span>{formatValue(value)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</article>
		</section>
	</div>
{/if}

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
		padding: 64px 8vw 72px;
		background:
			radial-gradient(circle at 12% 18%, rgba(255, 214, 153, 0.45), transparent 45%),
			radial-gradient(circle at 88% 6%, rgba(110, 177, 155, 0.35), transparent 40%),
			linear-gradient(140deg, #f6f0e6 0%, #f3e7d9 40%, #efe3cf 100%);
	}

	.loading-overlay {
		position: fixed;
		inset: 0;
		background: rgba(245, 239, 231, 0.88);
		backdrop-filter: blur(6px);
		display: grid;
		place-items: center;
		z-index: 40;
	}

	.loader {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-radius: 999px;
		border: 1px solid #d2c5b8;
		background: #fdfbf7;
		box-shadow: 0 12px 24px rgba(46, 35, 28, 0.12);
		font-weight: 600;
		color: #5b4f44;
	}

	.spinner {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 2px solid #d2c5b8;
		border-top-color: #0f6b4f;
		animation: spin 0.8s linear infinite;
	}

	.auth-gate {
		min-height: 100vh;
		display: grid;
		place-items: center;
		text-align: center;
		padding: 64px 8vw 72px;
		color: #6c5f52;
	}

	.top-bar {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}

	.hero {
		max-width: 900px;
		margin-bottom: 40px;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.25em;
		font-size: 12px;
		font-weight: 600;
		color: #6c5f52;
	}

	h1,
	h2,
	h3 {
		font-family: "Fraunces", "Georgia", serif;
		margin: 0 0 12px;
	}

	h1 {
		font-size: clamp(2.2rem, 3.6vw, 3rem);
		line-height: 1.05;
	}

	.hero-actions {
		margin-top: 24px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
	}

	.slug-pill {
		padding: 6px 12px;
		border-radius: 999px;
		border: 1px solid #d2c5b8;
		background: #fdfbf7;
		font-weight: 600;
		color: #5b4f44;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 20px;
	}

	.card {
		background: #fbf8f2;
		border: 1px solid #e2d7c7;
		border-radius: 20px;
		padding: 22px;
		box-shadow: 0 20px 40px rgba(46, 35, 28, 0.08);
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-height: 280px;
	}

	.card header p {
		margin: 0;
		color: #6c5f52;
	}

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}

	.stats-grid div {
		background: #f1e8dc;
		border-radius: 12px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stats-grid span {
		font-size: 0.85rem;
		color: #6c5f52;
	}

	.stats-grid strong {
		font-size: 1.25rem;
	}

	.list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 10px;
	}

	.stats-list {
		font-size: 0.92rem;
	}

	.list li {
		display: flex;
		justify-content: space-between;
		padding-bottom: 6px;
		border-bottom: 1px dashed #d9cdbd;
	}

	.team-link {
		color: inherit;
		text-decoration: none;
		font-weight: 600;
	}

	.team-link:hover {
		text-decoration: underline;
	}

	.stat-pair {
		color: #5b4f44;
		font-weight: 600;
	}

	.mode-select {
		display: grid;
		gap: 6px;
		font-weight: 600;
		color: #3f342b;
	}

	select {
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid #d8ccbc;
		background: #fff;
		font: inherit;
		color: inherit;
	}

	.stat-label {
		text-decoration: underline dotted;
		text-underline-offset: 3px;
		text-decoration-color: #b19f8e;
		cursor: help;
	}

	.muted {
		color: #6c5f52;
	}

	.error {
		color: #9b3a25;
		font-weight: 600;
	}

	button,
	.ghost {
		border: none;
		font: inherit;
		cursor: pointer;
		transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
	}

	.ghost {
		background: #fdfbf7;
		color: #1e1a17;
		border: 1px solid #d2c5b8;
		padding: 10px 16px;
		border-radius: 12px;
		font-weight: 600;
		text-decoration: none;
	}

	.ghost:hover {
		background: #f1e8dc;
		border-color: #cbbca9;
		transform: translateY(-1px);
	}

	.reveal {
		animation: fadeUp 0.7s ease both;
		animation-delay: var(--delay, 0s);
	}

	@keyframes fadeUp {
		from {
			opacity: 0;
			transform: translateY(18px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 700px) {
		.page {
			padding: 40px 6vw 64px;
		}

		.hero-actions {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
