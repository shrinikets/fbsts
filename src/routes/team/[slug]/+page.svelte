<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import { env } from "$env/dynamic/public";
	import { dev } from "$app/environment";
	import { getAccessToken, isAuthenticated } from "$lib/client/auth0";
	import { formatKey, statDescription, statLabel } from "$lib/stats-ui";

	type StatMode = "total" | "per-game";
	type TeamTotals = Record<string, number | null>;
	type MatchScorer = {
		player: string;
		goals: number;
	};
	type TeamMatch = {
		game_id: string;
		match_date: string | null;
		home_team: string | null;
		away_team: string | null;
		home_goals: number | null;
		away_goals: number | null;
		home_scorers: MatchScorer[];
		away_scorers: MatchScorer[];
	};
	type TeamPayload = {
		team: string;
		mode: StatMode;
		totals: TeamTotals;
		stats: Record<string, Record<string, number | null> | null>;
		matches: TeamMatch[];
	};

	const teamCache = new Map<string, TeamPayload>();
	const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";
	const apiBase = env.PUBLIC_API_BASE?.replace(/\/+$/, "") ?? "";
	const season = env.PUBLIC_DEFAULT_SEASON ?? "2024-2025";
	const competition = env.PUBLIC_DEFAULT_COMPETITION ?? "ENG-Premier League";

	let authReady = false;
	let authError = "";
	let loading = false;
	let error = "";
	let teamName = "";
	let teamData: TeamPayload | null = null;
	let teamTotalsView: TeamTotals = {};
	let teamStatsView: Record<string, Record<string, number | null> | null> = {};
	let teamMatches: TeamMatch[] = [];
	let statsExpanded = false;
	let mode: StatMode = "total";
	let lastSlug = "";
	let slug = "";
	let logoMissing = false;

	$: slug = $page.params.slug ?? "";
	$: {
		const nextMode = parseMode($page.url.searchParams.get("mode"));
		if (nextMode !== mode) {
			mode = nextMode;
		}
	}

	const parseMode = (value: string | null): StatMode => {
		if (value === "per-game" || value === "total") {
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

	const teamLogoPath = (team: string) => `/teams/${toSlug(team)}.png`;

	const teamInitials = (team: string) =>
		team
			.split(" ")
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0]?.toUpperCase())
			.join("");

	const formatValue = (value: number | null) =>
		value === null || value === undefined
			? "-"
			: Number.isInteger(value)
				? value.toLocaleString()
				: value.toLocaleString(undefined, { maximumFractionDigits: 2 });

	const formatMatchDate = (value: string | null) => {
		if (!value) {
			return "TBD";
		}
		const timestamp = Date.parse(value);
		if (Number.isNaN(timestamp)) {
			return value;
		}
		return new Intl.DateTimeFormat("en-US", {
			month: "short",
			day: "numeric"
		}).format(new Date(timestamp));
	};

	const formatScorers = (scorers: MatchScorer[]) => {
		if (!scorers.length) {
			return "—";
		}
		return scorers
			.map((scorer) => (scorer.goals > 1 ? `${scorer.player} (${scorer.goals})` : scorer.player))
			.join(", ");
	};

	const teamCacheKey = (value: string) => `${value}:${season}:${competition}`;

	const readStat = (totals: TeamTotals, keys: string[], fallback = 0) => {
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

	const loadTeam = async () => {
		if (!slug) {
			error = "Missing team slug.";
			return;
		}
		if (!authReady) {
			error = "Please log in to load team stats.";
			return;
		}
		const cacheKey = teamCacheKey(slug);
		const cached = teamCache.get(cacheKey);
		if (cached) {
			teamData = cached;
			teamName = cached.team;
			teamMatches = cached.matches ?? [];
			logoMissing = false;
			return;
		}
		loading = true;
		error = "";
		teamName = "";
		teamData = null;
		logoMissing = false;
		try {
			const params = new URLSearchParams({
				season,
				competition
			});
			const response = await authFetch(
				`/api/team/${encodeURIComponent(slug)}?${params.toString()}`,
				{ cache: "no-store" }
			);
			if (!response.ok) {
				error = await readError(response);
				return;
			}
			const payload = (await response.json()) as TeamPayload;
			teamCache.set(cacheKey, payload);
			teamData = payload;
			teamName = payload.team;
			teamMatches = payload.matches ?? [];
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to load team data.";
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

	$: teamName = teamData?.team ?? "";

	$: {
		if (teamData) {
			const matches = pickNumber(teamData.totals ?? {}, ["matches"]);
			const minutes = matches ? matches * 90 : null;
			const exclude = new Set(["matches", "min", "minutes"]);
			teamTotalsView = scaleTotals(teamData.totals ?? {}, mode, matches, minutes, exclude);
			teamStatsView = Object.fromEntries(
				Object.entries(teamData.stats ?? {}).map(([category, totals]) => {
					if (!totals) {
						return [category, null];
					}
					return [category, scaleTotals(totals, mode, matches, minutes, exclude)];
				})
			);
			teamMatches = teamData.matches ?? [];
		} else {
			teamTotalsView = {};
			teamStatsView = {};
			teamMatches = [];
		}
	}

	$: {
		if (authReady && slug) {
			if (slug !== lastSlug) {
				lastSlug = slug;
				void loadTeam();
			}
		}
	}
</script>

<svelte:head>
	<title>{teamName ? `${teamName} | fbsts` : "Team | fbsts"}</title>
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

		{#if loading && !teamData}
			<div class="loading-overlay" aria-live="polite">
				<div class="loader">
					<span class="spinner" aria-hidden="true"></span>
					<span>Loading team...</span>
				</div>
			</div>
		{/if}

		<header class="hero reveal" style="--delay: 0s">
			<p class="eyebrow">Team dashboard</p>
			<div class="hero-title">
				{#if teamName}
					{#if logoMissing}
						<span class="logo-fallback">{teamInitials(teamName)}</span>
					{:else}
						<img
							class="team-logo"
							src={teamLogoPath(teamName)}
							alt={teamName}
							loading="lazy"
							on:error={() => (logoMissing = true)}
						/>
					{/if}
				{/if}
				<h1>{teamName || (loading ? "Loading team..." : "Team")}</h1>
			</div>
			<div class="hero-actions">
				<label class="mode-select">
					Mode
					<select value={mode} on:change={updateMode}>
						<option value="total">Total</option>
						<option value="per-game">Per game</option>
					</select>
				</label>
				<div class="slug-pill">/team/{slug}</div>
			</div>
		</header>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<section class="grid">
			<article class="card reveal" style="--delay: 0.1s">
				<header class="card-header">
					<div>
						<h2>Core stats</h2>
					</div>
					<button
						class="collapse-toggle"
						type="button"
						on:click={() => (statsExpanded = !statsExpanded)}
						aria-expanded={statsExpanded}
						aria-label={statsExpanded ? "Collapse all stats" : "Expand all stats"}
					>
						<svg viewBox="0 0 24 24" aria-hidden="true" class:expanded={statsExpanded}>
							<path
								d="M6 9l6 6 6-6"
								fill="none"
								stroke="currentColor"
								stroke-width="1.8"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</button>
				</header>
				{#if loading}
					<p class="muted">Loading team totals...</p>
				{:else if Object.keys(teamTotalsView).length === 0}
					<p class="muted">No team totals available yet.</p>
				{:else}
					<div class="stats-grid">
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("points")}>
									{statLabel("points")}
								</abbr>
							</span>
							<strong>{formatValue(readStat(teamTotalsView, ["points"]))}</strong>
						</div>
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("wins")}>
									{statLabel("wins")}
								</abbr>
							</span>
							<strong>{formatValue(readStat(teamTotalsView, ["wins"]))}</strong>
						</div>
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("draws")}>
									{statLabel("draws")}
								</abbr>
							</span>
							<strong>{formatValue(readStat(teamTotalsView, ["draws"]))}</strong>
						</div>
						<div>
							<span>
								<abbr class="stat-label" title={statDescription("goal_diff")}>
									{statLabel("goal_diff")}
								</abbr>
							</span>
							<strong>{formatValue(readStat(teamTotalsView, ["goal_diff"]))}</strong>
						</div>
					</div>
				{/if}

				{#if statsExpanded}
					<div class="stats-divider"></div>
					{#if loading}
						<p class="muted">Loading team stats...</p>
					{:else if Object.keys(teamStatsView).length === 0}
						<p class="muted">No stats found yet.</p>
					{:else}
						{#each Object.entries(teamStatsView) as [category, totals]}
							{#if totals}
								<div class="stats-section">
									<h3>{formatKey(category)}</h3>
									<ul class="list stats-list">
										{#each sortedEntries(totals) as [key, value]}
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
								</div>
							{/if}
						{/each}
					{/if}
				{/if}
			</article>

			<article class="card reveal" style="--delay: 0.2s">
				<header>
					<h2>Match log</h2>
				</header>
				{#if loading}
					<p class="muted">Loading matches...</p>
				{:else if teamMatches.length === 0}
					<p class="muted">No matches found yet.</p>
				{:else}
					<ul class="match-list">
						{#each teamMatches as match}
							<li class="match-card">
								<div class="match-meta">
									<span>{formatMatchDate(match.match_date)}</span>
									<span class="match-venue">
										{match.home_team === teamName ? "Home" : "Away"}
									</span>
								</div>
								<div class="match-scoreline">
									<span class:highlight={match.home_team === teamName}>
										{match.home_team ?? "Home"}
									</span>
									<strong>{match.home_goals ?? "-"}</strong>
									<span class="score-divider">-</span>
									<strong>{match.away_goals ?? "-"}</strong>
									<span class:highlight={match.away_team === teamName}>
										{match.away_team ?? "Away"}
									</span>
								</div>
								<div class="match-scorers">
									<div>
										<span class="scorer-label">{match.home_team ?? "Home"}</span>
										<span class="scorer-list">{formatScorers(match.home_scorers)}</span>
									</div>
									<div>
										<span class="scorer-label">{match.away_team ?? "Away"}</span>
										<span class="scorer-list">{formatScorers(match.away_scorers)}</span>
									</div>
								</div>
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

	.hero-title {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
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

	.team-logo,
	.logo-fallback {
		width: 36px;
		height: 46px;
		border-radius: 8px;
		border: 1px solid #d8ccbc;
		background: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		font-weight: 700;
		color: #6c5f52;
		text-transform: uppercase;
	}

	.team-logo {
		object-fit: contain;
		padding: 2px;
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
		gap: 20px;
		align-items: start;
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

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
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

	.stats-section {
		background: #f5eee5;
		border-radius: 14px;
		padding: 12px;
		border: 1px solid #e5d8c8;
		display: grid;
		gap: 10px;
	}

	.stats-section h3 {
		margin: 0;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: #6c5f52;
	}

	.stats-divider {
		height: 1px;
		background: #e5d8c8;
		margin: 6px 0;
	}

	.collapse-toggle {
		width: 32px;
		height: 32px;
		border-radius: 999px;
		border: 1px solid #d2c5b8;
		background: #fdfbf7;
		color: #1e1a17;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
	}

	.collapse-toggle:hover {
		background: #f1e8dc;
		border-color: #cbbca9;
		transform: translateY(-1px);
	}

	.collapse-toggle svg {
		width: 18px;
		height: 18px;
		transition: transform 0.2s ease;
	}

	.collapse-toggle svg.expanded {
		transform: rotate(180deg);
	}

	.match-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 14px;
	}

	.match-card {
		padding: 14px;
		border-radius: 16px;
		border: 1px solid #e5d8c8;
		background: #f5eee5;
		display: grid;
		gap: 10px;
	}

	.match-meta {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
		color: #6c5f52;
	}

	.match-venue {
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-weight: 600;
	}

	.match-scoreline {
		display: grid;
		grid-template-columns: 1fr auto auto auto 1fr;
		align-items: center;
		gap: 8px;
		font-weight: 600;
	}

	.score-divider {
		color: #6c5f52;
	}

	.highlight {
		color: #0f6b4f;
		font-weight: 700;
	}

	.match-scorers {
		display: grid;
		gap: 6px;
		font-size: 0.85rem;
		color: #5b4f44;
	}

	.scorer-label {
		font-weight: 700;
		margin-right: 6px;
	}

	.scorer-list {
		color: #6c5f52;
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

		.grid {
			grid-template-columns: 1fr;
		}

		.hero-actions {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
