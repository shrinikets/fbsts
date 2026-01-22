<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { env } from "$env/dynamic/public";
	import { dev } from "$app/environment";
	import { getAccessToken, isAuthenticated } from "$lib/client/auth0";
	import { statDescription, statLabel } from "$lib/stats-ui";

	type LeaderboardRow = {
		player: string;
		value: number;
	};

	type StatMode = "total" | "per-game" | "per-90";

	type TableMeta = {
		table: string;
		label: string;
		columns: string[];
	};

	type LeaderboardCacheEntry = {
		ts: number;
		columns: string[];
		leaderboards: Record<string, LeaderboardRow[]>;
	};

	const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";
	const apiBase = env.PUBLIC_API_BASE?.replace(/\/+$/, "") ?? "";
	const season = env.PUBLIC_DEFAULT_SEASON ?? "2024-2025";
	const competition = env.PUBLIC_DEFAULT_COMPETITION ?? "ENG-Premier League";
	const LEADERBOARD_CACHE_TTL = 120_000;
	const leaderboardCache = new Map<string, LeaderboardCacheEntry>();

	let authReady = false;
	let authError = "";
	let loadingCatalog = false;
	let catalogError = "";
	let tables: TableMeta[] = [];
	let leaderboardsByTable: Record<string, Record<string, LeaderboardRow[]>> = {};
	let tableErrors: Record<string, string> = {};
	let tableLoading = new Set<string>();
	let tableLoaded = new Set<string>();
	let collapsedTables = new Set<string>();
	let mode: StatMode = "total";

	let modalOpen = false;
	let modalLoading = false;
	let modalError = "";
	let modalRows: LeaderboardRow[] = [];
	let modalStatKey = "";
	let modalTableLabel = "";

	const tableSkeletons = Array.from({ length: 4 });
	const statSkeletons = Array.from({ length: 6 });
	const rowSkeletons = Array.from({ length: 5 });

	const formatValue = (value: number) =>
		Number.isInteger(value)
			? value.toLocaleString()
			: value.toLocaleString(undefined, { maximumFractionDigits: 2 });

	const sortedStats = (columns: string[]) =>
		columns.slice().sort((a, b) => statLabel(a).localeCompare(statLabel(b)));

	const parseMode = (value: string | null): StatMode => {
		if (value === "per-game" || value === "per-90" || value === "total") {
			return value;
		}
		return "total";
	};

	const cacheKey = (tableName: string) => `${season}:${competition}:${mode}:${tableName}`;

	const readLeaderboardCache = (tableName: string) => {
		const entry = leaderboardCache.get(cacheKey(tableName));
		if (!entry) {
			return null;
		}
		if (Date.now() - entry.ts > LEADERBOARD_CACHE_TTL) {
			leaderboardCache.delete(cacheKey(tableName));
			return null;
		}
		return entry;
	};

	const writeLeaderboardCache = (
		tableName: string,
		columns: string[],
		leaderboards: Record<string, LeaderboardRow[]>
	) => {
		leaderboardCache.set(cacheKey(tableName), {
			ts: Date.now(),
			columns,
			leaderboards
		});
	};

	const toSlug = (value: string) =>
		value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-+|-+$)/g, "");

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

	const toggleTable = (tableName: string) => {
		const next = new Set(collapsedTables);
		if (next.has(tableName)) {
			next.delete(tableName);
		} else {
			next.add(tableName);
		}
		collapsedTables = next;
	};

	const goBack = () => {
		if (typeof window !== "undefined" && window.history.length > 1) {
			window.history.back();
			return;
		}
		void goto("/");
	};

	const loadCatalog = async () => {
		loadingCatalog = true;
		catalogError = "";
		try {
			const response = await authFetch(
				`/api/leaderboards?catalog=1&season=${encodeURIComponent(season)}&competition=${encodeURIComponent(
					competition
				)}`
			);
			if (!response.ok) {
				catalogError = response.statusText || "Failed to load leaderboards catalog.";
				return;
			}
			const payload = (await response.json()) as { tables: TableMeta[] };
			tables = payload.tables ?? [];
		} catch (err) {
			catalogError = err instanceof Error ? err.message : "Failed to load leaderboards catalog.";
		} finally {
			loadingCatalog = false;
		}
	};

	const loadTable = async (table: TableMeta) => {
		if (tableLoading.has(table.table)) {
			return;
		}
		const cached = readLeaderboardCache(table.table);
		if (cached) {
			leaderboardsByTable = {
				...leaderboardsByTable,
				[table.table]: cached.leaderboards
			};
			tables = tables.map((entry) =>
				entry.table === table.table ? { ...entry, columns: cached.columns } : entry
			);
			tableLoaded = new Set(tableLoaded);
			tableLoaded.add(table.table);
			tableErrors = { ...tableErrors, [table.table]: "" };
			return;
		}
		tableLoading = new Set(tableLoading);
		tableLoading.add(table.table);
		tableLoaded = new Set([...tableLoaded].filter((value) => value !== table.table));
		tableErrors = { ...tableErrors, [table.table]: "" };
		try {
			const params = new URLSearchParams({
				table: table.table,
				limit: "5",
				season,
				competition
			});
			if (mode !== "total") {
				params.set("mode", mode);
			}
			const response = await authFetch(`/api/leaderboards?${params.toString()}`, {
				cache: "force-cache"
			});
			if (!response.ok) {
				tableErrors = {
					...tableErrors,
					[table.table]: response.statusText || "Failed to load leaderboards."
				};
				return;
			}
			const payload = (await response.json()) as {
				table: string;
				columns: string[];
				leaderboards: Record<string, LeaderboardRow[]>;
			};
			leaderboardsByTable = {
				...leaderboardsByTable,
				[payload.table]: payload.leaderboards ?? {}
			};
			writeLeaderboardCache(
				payload.table,
				payload.columns ?? table.columns,
				payload.leaderboards ?? {}
			);
			if (payload.columns?.length) {
				tables = tables.map((entry) =>
					entry.table === payload.table ? { ...entry, columns: payload.columns } : entry
				);
			}
			tableLoaded = new Set(tableLoaded);
			tableLoaded.add(payload.table);
		} catch (err) {
			tableErrors = {
				...tableErrors,
				[table.table]: err instanceof Error ? err.message : "Failed to load leaderboards."
			};
		} finally {
			tableLoading = new Set([...tableLoading].filter((value) => value !== table.table));
		}
	};

	const openModal = async (table: TableMeta, statKey: string) => {
		modalOpen = true;
		modalLoading = true;
		modalError = "";
		modalRows = [];
		modalStatKey = statKey;
		modalTableLabel = table.label;
		try {
			const params = new URLSearchParams({
				table: table.table,
				column: statKey,
				season,
				competition
			});
			if (mode !== "total") {
				params.set("mode", mode);
			}
			const response = await authFetch(
				`/api/leaderboards?${params.toString()}`
			);
			if (!response.ok) {
				modalError = response.statusText || "Failed to load leaderboard.";
				return;
			}
			const payload = (await response.json()) as { rows: LeaderboardRow[] };
			modalRows = payload.rows ?? [];
		} catch (err) {
			modalError = err instanceof Error ? err.message : "Failed to load leaderboard.";
		} finally {
			modalLoading = false;
		}
	};

	const closeModal = () => {
		modalOpen = false;
	};

	const loadAllTables = async () => {
		leaderboardsByTable = {};
		tableErrors = {};
		tableLoading = new Set();
		tableLoaded = new Set();
		await Promise.all(tables.map((table) => loadTable(table)));
	};

	const updateMode = async (event: Event) => {
		const value = (event.target as HTMLSelectElement).value as StatMode;
		mode = value;
		modalOpen = false;
		if (typeof window !== "undefined") {
			const url = new URL(window.location.href);
			if (value === "total") {
				url.searchParams.delete("mode");
			} else {
				url.searchParams.set("mode", value);
			}
			await goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
		}
		await loadAllTables();
	};

	onMount(() => {
		if (typeof window !== "undefined") {
			mode = parseMode(new URLSearchParams(window.location.search).get("mode"));
		}
		const bootstrap = async () => {
			authError = "";
			authReady = false;
			if (authBypass) {
				authReady = true;
				await loadCatalog();
				await loadAllTables();
				return;
			}
			try {
				const authed = await isAuthenticated();
				if (!authed) {
					await goto("/login");
					return;
				}
				authReady = true;
				await loadCatalog();
				await loadAllTables();
			} catch (err) {
				authError = err instanceof Error ? err.message : "Auth check failed.";
			}
		};
		void bootstrap();
	});
</script>

<svelte:head>
	<title>Leaderboards | fbsts</title>
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

		<header class="hero reveal" style="--delay: 0s">
			<p class="eyebrow">Leaderboards</p>
			<h1>Every stat, ranked.</h1>
			<div class="hero-actions">
				<label class="mode-select">
					Mode
					<select value={mode} on:change={updateMode}>
						<option value="total">Total</option>
						<option value="per-game">Per game</option>
						<option value="per-90">Per 90</option>
					</select>
				</label>
			</div>
		</header>

		{#if loadingCatalog}
			<section class="leaderboard-stack">
				{#each tableSkeletons as _}
					<article class="card reveal" style="--delay: 0.1s">
						<div class="skeleton skeleton-title"></div>
						<div class="stat-grid">
							{#each statSkeletons as _}
								<div class="stat-card">
									<div class="stat-header">
										<div class="skeleton skeleton-line"></div>
										<div class="skeleton skeleton-square"></div>
									</div>
									{#each rowSkeletons as _}
										<div class="skeleton skeleton-line"></div>
									{/each}
								</div>
							{/each}
						</div>
					</article>
				{/each}
			</section>
		{:else if catalogError}
			<p class="error">{catalogError}</p>
		{:else}
			<section class="leaderboard-stack">
				{#each tables as table}
					<article class="card reveal" style="--delay: 0.1s">
						<header class="card-header">
							<div>
								<h2>{table.label}</h2>
							</div>
							<div class="table-actions">
								<span class="table-status">
									{#if tableLoading.has(table.table) || !tableLoaded.has(table.table)}
										<span class="skeleton skeleton-chip"></span>
									{:else if tableErrors[table.table]}
										Error
									{:else}
										{table.columns.length} stats
									{/if}
								</span>
								<button
									class="collapse-toggle"
									type="button"
									aria-label={
										collapsedTables.has(table.table)
											? `Expand ${table.label}`
											: `Collapse ${table.label}`
									}
									aria-expanded={!collapsedTables.has(table.table)}
									on:click={() => toggleTable(table.table)}
								>
									<svg
										viewBox="0 0 24 24"
										aria-hidden="true"
										class:expanded={!collapsedTables.has(table.table)}
									>
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
							</div>
						</header>

						{#if tableErrors[table.table]}
							<p class="error">{tableErrors[table.table]}</p>
						{:else if !collapsedTables.has(table.table)}
							<div class="stat-grid">
								{#each sortedStats(table.columns) as statKey}
									<div class="stat-card">
										<div class="stat-header">
											<div>
												<h3>
													<abbr class="stat-label" title={statDescription(statKey)}>
														{statLabel(statKey)}
													</abbr>
												</h3>
											</div>
											<button
												class="expand-link"
												type="button"
												on:click={() => openModal(table, statKey)}
												aria-label={`Expand ${statLabel(statKey)} leaderboard`}
											>
												<svg viewBox="0 0 24 24" aria-hidden="true">
													<path
														d="M9 4h11v11"
														fill="none"
														stroke="currentColor"
														stroke-width="1.6"
														stroke-linecap="round"
														stroke-linejoin="round"
													/>
													<path
														d="M4 9v11h11"
														fill="none"
														stroke="currentColor"
														stroke-width="1.6"
														stroke-linecap="round"
														stroke-linejoin="round"
													/>
													<path
														d="M13 11l7-7"
														fill="none"
														stroke="currentColor"
														stroke-width="1.6"
														stroke-linecap="round"
														stroke-linejoin="round"
													/>
													<path
														d="M4 20l7-7"
														fill="none"
														stroke="currentColor"
														stroke-width="1.6"
														stroke-linecap="round"
														stroke-linejoin="round"
													/>
												</svg>
											</button>
										</div>
										{#if tableLoading.has(table.table) || !tableLoaded.has(table.table)}
											<div class="stat-list-skeleton">
												{#each rowSkeletons as _}
													<div class="skeleton skeleton-line"></div>
												{/each}
											</div>
										{:else}
											{@const statRows = leaderboardsByTable[table.table]?.[statKey]}
											{#if statRows === undefined}
												<div class="stat-list-skeleton">
													{#each rowSkeletons as _}
														<div class="skeleton skeleton-line"></div>
													{/each}
												</div>
											{:else}
												<ul>
													{#each statRows as row, index}
														<li>
															<span class="rank">{index + 1}</span>
															<a
																class="player-link"
																href={`/player/${encodeURIComponent(toSlug(row.player))}`}
															>
																{row.player}
															</a>
															<span class="value">{formatValue(row.value)}</span>
														</li>
													{/each}
													{#if statRows.length === 0}
														<li class="muted">No data yet.</li>
													{/if}
												</ul>
											{/if}
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					</article>
				{/each}
			</section>
		{/if}
	</div>
{/if}

{#if modalOpen}
	<div class="modal-backdrop" on:click={closeModal}>
		<div class="modal" role="dialog" aria-modal="true" on:click|stopPropagation>
			<header>
				<h2>{statLabel(modalStatKey)}</h2>
				<p>{modalTableLabel}</p>
				<button class="ghost" type="button" on:click={closeModal}>Close</button>
			</header>
			{#if modalLoading}
				<div class="stat-list-skeleton">
					{#each Array.from({ length: 10 }) as _}
						<div class="skeleton skeleton-line"></div>
					{/each}
				</div>
			{:else if modalError}
				<p class="error">{modalError}</p>
			{:else}
				<ul class="modal-list">
					{#each modalRows as row, index}
						<li>
							<span class="rank">{index + 1}</span>
							<a class="player-link" href={`/player/${encodeURIComponent(toSlug(row.player))}`}>
								{row.player}
							</a>
							<span class="value">{formatValue(row.value)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
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
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}

	.hero {
		max-width: 900px;
		margin-bottom: 40px;
	}

	.hero-actions {
		margin-top: 20px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
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

	.leaderboard-stack {
		display: grid;
		gap: 24px;
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

	.table-status {
		font-size: 0.85rem;
		color: #6c5f52;
		font-weight: 600;
		display: inline-flex;
		min-width: 80px;
	}

	.table-actions {
		display: inline-flex;
		align-items: center;
		gap: 10px;
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

	.skeleton {
		display: inline-block;
		width: 100%;
		border-radius: 999px;
		background: linear-gradient(90deg, #efe5d6 0%, #f7f1e8 50%, #efe5d6 100%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease infinite;
	}

	.skeleton-title {
		height: 16px;
		width: 40%;
	}

	.skeleton-line {
		height: 12px;
	}

	.skeleton-chip {
		height: 12px;
		width: 60px;
	}

	.skeleton-square {
		width: 28px;
		height: 28px;
		border-radius: 8px;
	}

	.stat-list-skeleton {
		display: grid;
		gap: 8px;
	}

	.stat-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 16px;
	}

	.stat-card {
		background: #f5eee5;
		border-radius: 14px;
		padding: 14px;
		border: 1px solid #e5d8c8;
		display: grid;
		gap: 10px;
	}

	.stat-header {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		align-items: flex-start;
	}

	.stat-card h3 {
		font-size: 1rem;
		margin: 0;
	}

	.stat-card ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 6px;
	}

	.stat-card li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 8px;
		align-items: center;
		font-size: 0.9rem;
	}

	.rank {
		font-weight: 700;
		color: #6c5f52;
	}

	.player {
		font-weight: 600;
	}

	.player-link {
		font-weight: 600;
		color: inherit;
		text-decoration: none;
	}

	.player-link:hover {
		text-decoration: underline;
	}

	.value {
		font-weight: 700;
		color: #0f6b4f;
	}

	.expand-link {
		width: 32px;
		height: 32px;
		border-radius: 10px;
		border: 1px solid #d2c5b8;
		background: #fdfbf7;
		color: #1e1a17;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
	}

	.expand-link:hover {
		background: #f1e8dc;
		border-color: #cbbca9;
		transform: translateY(-1px);
	}

	.expand-link svg {
		width: 16px;
		height: 16px;
	}

	.stat-label {
		text-decoration: underline dotted;
		text-underline-offset: 3px;
		text-decoration-color: #b19f8e;
		cursor: help;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(30, 26, 23, 0.6);
		display: grid;
		place-items: center;
		padding: 24px;
		z-index: 50;
	}

	.modal {
		background: #fbf8f2;
		border-radius: 20px;
		padding: 20px;
		max-width: 620px;
		width: min(90vw, 620px);
		max-height: 80vh;
		overflow: auto;
		display: grid;
		gap: 12px;
		box-shadow: 0 30px 60px rgba(0, 0, 0, 0.2);
	}

	.modal header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 12px;
	}

	.modal header p {
		margin: 0;
		color: #6c5f52;
	}

	.modal-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.modal-list li {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 8px;
		align-items: center;
		border-bottom: 1px dashed #d9cdbd;
		padding-bottom: 6px;
	}

	.ghost {
		background: #fdfbf7;
		color: #1e1a17;
		border: 1px solid #d2c5b8;
		padding: 10px 16px;
		border-radius: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
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

	@media (max-width: 700px) {
		.page {
			padding: 40px 6vw 64px;
		}

		.stat-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
