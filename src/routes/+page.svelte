<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { dev } from "$app/environment";
	import { env } from "$env/dynamic/public";
	import { getAccessToken, isAuthenticated } from "$lib/client/auth0";

	type LeagueRow = {
		team: string;
		played: number;
		wins: number;
		draws: number;
		losses: number;
		gf: number;
		ga: number;
		gd: number;
		pts: number;
	};

	type ScheduleRow = {
		match_date: string | null;
		home_team: string | null;
		away_team: string | null;
	};

	type Leaderboard = {
		title: string;
		items: { name: string; value: number; team?: string }[];
	};

	type DashboardPayload = {
		season: string;
		competition: string;
		standings: LeagueRow[];
		schedule: ScheduleRow[];
		leaderboards: {
			goals: { player: string; value: number }[];
			assists: { player: string; value: number }[];
			yellows: { player: string; value: number }[];
			reds: { player: string; value: number }[];
			tackles: { player: string; value: number }[];
			xg: { player: string; value: number }[];
		};
	};

	type DashboardCacheEntry = {
		ts: number;
		payload: DashboardPayload;
	};

	const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";
	const apiBase = env.PUBLIC_API_BASE?.replace(/\/+$/, "") ?? "";
	const season = env.PUBLIC_DEFAULT_SEASON ?? "2024-2025";
	const competition = env.PUBLIC_DEFAULT_COMPETITION ?? "ENG-Premier League";
	const DASHBOARD_CACHE_TTL = 60_000;

	let authReady = false;
	let authError = "";

	let tableLoading = false;
	let tableError = "";
	let leagueRows: LeagueRow[] = [];
	let scheduleRows: ScheduleRow[] = [];

	let missingLogos = new Set<string>();

	let leaderboards: Leaderboard[] = [
		{ title: "Goals", items: [] },
		{ title: "Assists", items: [] },
		{ title: "Yellows", items: [] },
		{ title: "Reds", items: [] },
		{ title: "Tackles", items: [] },
		{ title: "xG", items: [] }
	];

	const tableSkeletonRows = Array.from({ length: 8 });
	const scheduleSkeletonRows = Array.from({ length: 5 });
	const leaderboardSkeletons = Array.from({ length: 6 });
	const leaderboardSkeletonRows = Array.from({ length: 4 });

	const toSlug = (value: string) =>
		value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
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

	const markMissingLogo = (team: string) => {
		if (missingLogos.has(team)) {
			return;
		}
		missingLogos = new Set(missingLogos);
		missingLogos.add(team);
	};

	const formatNumber = (value: number) =>
		Number.isInteger(value)
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

	const dashboardCacheKey = () => `fbsts:dashboard:${season}:${competition}`;

	const readDashboardCache = () => {
		if (typeof window === "undefined") {
			return null;
		}
		const raw = sessionStorage.getItem(dashboardCacheKey());
		if (!raw) {
			return null;
		}
		try {
			const entry = JSON.parse(raw) as DashboardCacheEntry;
			if (Date.now() - entry.ts > DASHBOARD_CACHE_TTL) {
				sessionStorage.removeItem(dashboardCacheKey());
				return null;
			}
			return entry.payload;
		} catch {
			sessionStorage.removeItem(dashboardCacheKey());
			return null;
		}
	};

	const writeDashboardCache = (payload: DashboardPayload) => {
		if (typeof window === "undefined") {
			return;
		}
		try {
			const entry = JSON.stringify({ ts: Date.now(), payload });
			sessionStorage.setItem(dashboardCacheKey(), entry);
		} catch {
			return;
		}
	};

	const applyDashboardPayload = (payload: DashboardPayload) => {
		leagueRows = payload.standings ?? [];
		scheduleRows = payload.schedule ?? [];
		leaderboards = [
			{
				title: "Goals",
				items: (payload.leaderboards?.goals ?? []).map((row) => ({
					name: row.player,
					value: row.value
				}))
			},
			{
				title: "Assists",
				items: (payload.leaderboards?.assists ?? []).map((row) => ({
					name: row.player,
					value: row.value
				}))
			},
			{
				title: "Yellows",
				items: (payload.leaderboards?.yellows ?? []).map((row) => ({
					name: row.player,
					value: row.value
				}))
			},
			{
				title: "Reds",
				items: (payload.leaderboards?.reds ?? []).map((row) => ({
					name: row.player,
					value: row.value
				}))
			},
			{
				title: "Tackles",
				items: (payload.leaderboards?.tackles ?? []).map((row) => ({
					name: row.player,
					value: row.value
				}))
			},
			{
				title: "xG",
				items: (payload.leaderboards?.xg ?? []).map((row) => ({
					name: row.player,
					value: row.value
				}))
			}
		];
	};

	const loadDashboard = async () => {
		tableLoading = true;
		tableError = "";
		try {
			const cached = readDashboardCache();
			if (cached) {
				applyDashboardPayload(cached);
				return;
			}
			const params = new URLSearchParams({
				season,
				competition,
				limit: "6"
			});
			const response = await authFetch(`/api/dashboard?${params.toString()}`, {
				cache: "force-cache"
			});
			if (!response.ok) {
				tableError = response.statusText || "Failed to load dashboard.";
				return;
			}
			const payload = (await response.json()) as DashboardPayload;
			applyDashboardPayload(payload);
			writeDashboardCache(payload);
		} catch (err) {
			tableError = err instanceof Error ? err.message : "Failed to load dashboard.";
		} finally {
			tableLoading = false;
		}
	};

	const bootstrap = async () => {
		authError = "";
		authReady = false;
		if (authBypass) {
			authReady = true;
			await loadDashboard();
			return;
		}
		try {
			const authed = await isAuthenticated();
			if (!authed) {
				await goto("/login");
				return;
			}
			authReady = true;
			await loadDashboard();
		} catch (err) {
			authError = err instanceof Error ? err.message : "Auth check failed.";
		}
	};

	onMount(() => {
		void bootstrap();
	});
</script>

<svelte:head>
	<title>fbsts | Dashboard</title>
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
			<a class="ghost" href="/logout">Log out</a>
		</div>

		<header class="hero reveal" style="--delay: 0s">
			<p class="eyebrow">FBSTS dashboard</p>
			<h1>Premier League analytics, built for fast comparisons.</h1>
			<div class="hero-actions">
				<a class="primary" href="#leaderboards">Jump to leaderboards</a>
			</div>
		</header>

		<section class="dashboard-grid">
			<article class="card table-card reveal" style="--delay: 0.1s">
				<header class="card-header">
					<div>
						<h2>League table</h2>
					</div>
				</header>
				{#if tableLoading}
					<div class="table-skeleton">
						{#each tableSkeletonRows as _}
							<div class="skeleton skeleton-row"></div>
						{/each}
					</div>
				{:else if tableError}
					<p class="error">{tableError}</p>
				{:else}
					<div class="table-scroll">
						<table>
							<thead>
								<tr>
									<th>#</th>
									<th>Team</th>
									<th>P</th>
									<th>W</th>
									<th>D</th>
									<th>L</th>
									<th>GF</th>
									<th>GA</th>
									<th>GD</th>
									<th>Pts</th>
								</tr>
							</thead>
							<tbody>
								{#each leagueRows as row, index}
									<tr>
										<td class="rank">{index + 1}</td>
										<td>
										<a class="team-link" href={`/team/${encodeURIComponent(toSlug(row.team))}`}>
												{#if missingLogos.has(row.team)}
													<span class="logo-fallback">{teamInitials(row.team)}</span>
												{:else}
													<img
														class="team-logo"
														src={teamLogoPath(row.team)}
														alt={row.team}
														loading="lazy"
														on:error={() => markMissingLogo(row.team)}
													/>
												{/if}
												<span class="team-name">{row.team}</span>
											</a>
										</td>
										<td>{formatNumber(row.played)}</td>
										<td>{formatNumber(row.wins)}</td>
										<td>{formatNumber(row.draws)}</td>
										<td>{formatNumber(row.losses)}</td>
										<td>{formatNumber(row.gf)}</td>
										<td>{formatNumber(row.ga)}</td>
										<td class={row.gd >= 0 ? "positive" : "negative"}>
											{row.gd >= 0 ? "+" : ""}{formatNumber(row.gd)}
										</td>
										<td class="points">{formatNumber(row.pts)}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</article>

			<article class="card reveal" style="--delay: 0.2s">
				<header class="card-header">
					<div>
						<h2>Match schedule</h2>
					</div>
				</header>
				{#if tableLoading}
					<ul class="schedule-list skeleton-list">
						{#each scheduleSkeletonRows as _}
							<li class="schedule-skeleton">
								<span class="skeleton skeleton-chip"></span>
								<span class="skeleton skeleton-line"></span>
								<span class="skeleton skeleton-chip"></span>
							</li>
						{/each}
					</ul>
				{:else if tableError}
					<p class="error">{tableError}</p>
				{:else if scheduleRows.length === 0}
					<p class="muted">No upcoming matches found.</p>
				{:else}
					<ul class="schedule-list">
						{#each scheduleRows as match}
							<li>
								<span class="schedule-time">{formatMatchDate(match.match_date)}</span>
								<span class="schedule-teams">
									{match.home_team ?? "Home"} vs {match.away_team ?? "Away"}
								</span>
								<span class="schedule-venue">{season}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</article>

			<article class="card reveal" style="--delay: 0.25s" id="leaderboards">
				<header class="card-header">
					<div>
						<h2>Leaderboards</h2>
					</div>
					<a class="arrow-link" href="/leaderboards" aria-label="View all leaderboards">
						<svg viewBox="0 0 24 24">
							<path
								d="M6 12h12M13 6l6 6-6 6"
								fill="none"
								stroke="currentColor"
								stroke-width="1.6"
								stroke-linecap="round"
								stroke-linejoin="round"
							/>
						</svg>
					</a>
				</header>
				{#if tableLoading}
					<div class="leaderboard-grid">
						{#each leaderboardSkeletons as _}
							<div class="leaderboard">
								<div class="skeleton skeleton-title"></div>
								{#each leaderboardSkeletonRows as _}
									<div class="skeleton skeleton-line"></div>
								{/each}
							</div>
						{/each}
					</div>
				{:else if tableError}
					<p class="error">{tableError}</p>
				{:else}
					<div class="leaderboard-grid">
						{#each leaderboards as board}
							<div class="leaderboard">
								<h3>{board.title}</h3>
								{#if board.items.length === 0}
									<p class="muted">No data available yet.</p>
								{:else}
									<ul>
										{#each board.items as item}
											<li>
												<a href={`/player/${encodeURIComponent(toSlug(item.name))}`}>
													<span>{item.name}</span>
													<strong>{formatNumber(item.value)}</strong>
												</a>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</article>

			<article class="card reveal" style="--delay: 0.3s">
				<header class="card-header">
					<div>
						<h2>Data Hub</h2>
					</div>
				</header>
			</article>
		</section>

		<footer class="foot reveal" style="--delay: 0.35s">
			<a
				class="github-button"
				href="https://github.com/shrinikets/fbsts"
				target="_blank"
				rel="noreferrer"
			>
				<svg class="github-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<path
						d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
					/>
				</svg>
			</a>
			<div class="copyright">(c) 2026 Shriniket Sivakumar</div>
			<span></span>
		</footer>
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
		justify-content: flex-end;
		gap: 12px;
		margin-bottom: 16px;
	}

	.hero {
		max-width: 880px;
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
		font-size: clamp(2.4rem, 4vw, 3.4rem);
		line-height: 1.05;
	}

	.hero-actions {
		margin-top: 24px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
	}

	.dashboard-grid {
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

	.table-card {
		min-height: 420px;
	}

	.card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.card-header p {
		margin: 0;
		color: #6c5f52;
	}

	.table-scroll {
		overflow-x: auto;
		position: relative;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.92rem;
	}

	th,
	td {
		padding: 10px 8px;
		text-align: left;
		border-bottom: 1px solid #e5d8c8;
	}

	th {
		font-size: 0.75rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #6c5f52;
	}

	.table-skeleton {
		display: grid;
		gap: 10px;
		margin-top: 12px;
	}

	.skeleton {
		display: inline-block;
		width: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, #efe5d6 0%, #f7f1e8 50%, #efe5d6 100%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease infinite;
	}

	.skeleton-row {
		height: 14px;
	}

	.skeleton-line {
		height: 12px;
	}

	.skeleton-title {
		height: 16px;
		width: 60%;
	}

	.skeleton-chip {
		height: 12px;
		width: 70px;
	}


	.rank {
		color: #6c5f52;
		font-weight: 600;
	}

	.team-link {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: inherit;
		text-decoration: none;
		font-weight: 600;
	}

	.team-link:hover {
		text-decoration: underline;
	}

	.team-logo,
	.logo-fallback {
		width: 28px;
		height: 36px;
		border-radius: 8px;
		border: 1px solid #d8ccbc;
		background: #fff;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.65rem;
		font-weight: 700;
		color: #6c5f52;
		text-transform: uppercase;
	}

	.team-logo {
		object-fit: contain;
		padding: 2px;
	}

	.points {
		font-weight: 700;
	}

	.positive {
		color: #0f6b4f;
		font-weight: 600;
	}

	.negative {
		color: #9b3a25;
		font-weight: 600;
	}

	.schedule-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 12px;
	}

	.schedule-list li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 12px;
		padding: 10px 12px;
		border-radius: 12px;
		background: #f1e8dc;
		color: #5b4f44;
	}

	.skeleton-list li {
		background: transparent;
		border: 1px solid #eadfce;
	}

	.schedule-skeleton {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 12px;
		align-items: center;
	}

	.schedule-time {
		font-weight: 600;
	}

	.schedule-venue {
		text-align: right;
		color: #6c5f52;
	}

	.leaderboard-grid {
		display: grid;
		gap: 16px;
	}

	.leaderboard {
		background: #f5eee5;
		border-radius: 14px;
		padding: 14px;
		border: 1px solid #e5d8c8;
		display: grid;
		gap: 8px;
	}

	.leaderboard h3 {
		margin: 0;
		font-size: 1rem;
		color: #3f342b;
	}

	.leaderboard ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.leaderboard li a {
		display: flex;
		justify-content: space-between;
		text-decoration: none;
		color: inherit;
		font-weight: 600;
	}

	.leaderboard li a:hover {
		text-decoration: underline;
	}

	.arrow-link {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid #d2c5b8;
		background: #fdfbf7;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: #1e1a17;
		transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
	}

	.arrow-link:hover {
		background: #f1e8dc;
		border-color: #cbbca9;
		transform: translateY(-1px);
	}

	.arrow-link svg {
		width: 18px;
		height: 18px;
		fill: currentColor;
	}

	button,
	.primary,
	.ghost {
		border: none;
		font: inherit;
		cursor: pointer;
		transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
	}

	.primary {
		background: #0f6b4f;
		color: #f7f4ed;
		padding: 12px 20px;
		border-radius: 999px;
		font-weight: 600;
		box-shadow: 0 10px 24px rgba(15, 107, 79, 0.2);
		text-decoration: none;
		display: inline-flex;
		align-items: center;
	}

	.primary:hover {
		transform: translateY(-1px);
		filter: brightness(1.03);
		box-shadow: 0 14px 28px rgba(15, 107, 79, 0.25);
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

	.muted {
		color: #6c5f52;
	}

	.error {
		color: #9b3a25;
		font-weight: 600;
	}

	.foot {
		margin-top: 32px;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		justify-items: center;
		gap: 12px;
		color: #5b4f44;
		align-items: center;
	}

	.github-button {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: 999px;
		border: 1px solid #d2c5b8;
		background: #fdfbf7;
		color: #1e1a17;
		text-decoration: none;
		font-weight: 600;
		justify-self: start;
		transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease,
			box-shadow 0.2s ease;
	}

	.github-button:hover {
		background: #f1e8dc;
		border-color: #cbbca9;
		transform: translateY(-1px);
		box-shadow: 0 10px 20px rgba(46, 35, 28, 0.12);
	}

	.github-icon {
		width: 18px;
		height: 18px;
		fill: currentColor;
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

	@keyframes shimmer {
		0% {
			background-position: 0% 50%;
		}
		100% {
			background-position: 200% 50%;
		}
	}

	@media (min-width: 980px) {
		.table-card {
			grid-column: span 2;
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

		.schedule-list li {
			grid-template-columns: 1fr;
			gap: 6px;
		}

		.schedule-venue {
			text-align: left;
		}
	}
</style>
