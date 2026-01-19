<script lang="ts">
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import { getAccessToken, isAuthenticated } from "$lib/client/auth0";
	import { env } from "$env/dynamic/public";
	import { dev } from "$app/environment";

	type PlayerTotals = Record<string, number | null>;
	type Option = {
		name: string;
		normalized: string;
	};
	type PlayerByTeam = {
		team: string | null;
		appearances: number;
		goals: number;
		assists: number;
		minutes: number;
	};
	type PlayerByTeamView = PlayerByTeam & {
		scaled: Record<string, number | null>;
	};
	type PlayerPayload = {
		player: string;
		totals: PlayerTotals;
		byTeam: PlayerByTeam[];
	};
	type TeamTotals = Record<string, number | null>;
	type TeamPayload = {
		team: string;
		totals: TeamTotals;
		stats: Record<string, Record<string, number | null> | null>;
	};
	type StatMode = "total" | "per-game" | "per-90";
	let playerQuery = "";
	let teamQuery = "";

	let playerSlug = "";
	let teamSlug = "";

	let playerOptions: Option[] = [];
	let teamOptions: Option[] = [];
	let playerMatches: Option[] = [];
	let teamMatches: Option[] = [];

	let playerMode: StatMode = "total";
	let teamMode: StatMode = "total";

	let playerData: PlayerPayload | null = null;
	let teamData: TeamPayload | null = null;
	let playerTotalsView: PlayerTotals = {};
	let teamTotalsView: TeamTotals = {};
	let teamStatsView: Record<string, Record<string, number | null> | null> = {};
	let playerByTeamView: PlayerByTeamView[] = [];

	let playerError = "";
	let teamError = "";
	let optionsError = "";

	let playerLoading = false;
	let teamLoading = false;
	let optionsLoading = false;
	let authReady = false;
	let authError = "";
	const authBypass = dev && env.PUBLIC_AUTH0_BYPASS === "1";
	const apiBase = env.PUBLIC_API_BASE?.replace(/\/+$/, "") ?? "";

	let playerDropdownOpen = false;
	let teamDropdownOpen = false;

	let playerBox: HTMLDivElement | null = null;
	let teamBox: HTMLDivElement | null = null;
	let playerSlugHref = "";
	let teamSlugHref = "";

	const normalizeText = (value: string) =>
		value
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.toLowerCase();

	const toSlug = (value: string) =>
		normalizeText(value)
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-+|-+$)/g, "");

	const toSearch = (value: string) =>
		normalizeText(value)
			.replace(/[^a-z0-9]+/g, " ")
			.replace(/\s+/g, " ")
			.trim();

	const modeHref = (base: string, mode: StatMode) =>
		mode === "total" ? base : `${base}?mode=${encodeURIComponent(mode)}`;

	const makeOptions = (items: string[]) => items.map((name) => ({ name, normalized: toSearch(name) }));

	const filterOptions = (items: Option[], query: string) => {
		if (!items.length) {
			return [];
		}
		const normalized = toSearch(query);
		if (!normalized) {
			return items;
		}
		return items.filter((item) => item.normalized.includes(normalized));
	};

	$: playerSlug = toSlug(playerQuery);
	$: teamSlug = toSlug(teamQuery);
	$: playerMatches = filterOptions(playerOptions, playerQuery);
	$: teamMatches = filterOptions(teamOptions, teamQuery);
	$: playerSlugHref = playerSlug ? modeHref(`/api-view/player/${encodeURIComponent(playerSlug)}`, playerMode) : "";
	$: teamSlugHref = teamSlug ? modeHref(`/api-view/team/${encodeURIComponent(teamSlug)}`, teamMode) : "";

	const readError = async (response: Response) => {
		try {
			const data = await response.json();
			return data?.message || response.statusText;
		} catch {
			return response.statusText;
		}
	};

	const resetErrors = () => {
		playerError = "";
		teamError = "";
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

	const selectPlayer = (name: string) => {
		playerQuery = name;
		playerDropdownOpen = false;
	};

	const selectTeam = (name: string) => {
		teamQuery = name;
		teamDropdownOpen = false;
	};

	const formatKey = (value: string) =>
		value
			.split("_")
			.map((part) => (part.length <= 3 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))
			.join(" ");

	const STAT_LABELS: Record<string, string> = {
		appearances: "Appearances",
		matches: "Matches",
		min: "Minutes",
		minutes: "Minutes",
		points: "Points",
		wins: "Wins",
		draws: "Draws",
		losses: "Losses",
		goal_diff: "Goal Difference",
		goals_for: "Goals For",
		goals_against: "Goals Against",
		gf: "Goals For",
		ga: "Goals Against",
		goals: "Goals",
		assists: "Assists",
		xg: "xG",
		xga: "xGA",
		npxg: "npxG",
		npxgd: "npxG Diff",
		poss: "Possession %",
		attendance: "Attendance",
		standard_gls: "Goals",
		standard_sh: "Shots",
		standard_sot: "Shots on Target",
		standard_sot_2: "Shots on Target %",
		standard_g_sh: "Goals per Shot",
		standard_g_sot: "Goals per SoT",
		standard_dist: "Shot Distance",
		standard_fk: "Free Kick Shots",
		standard_pk: "Penalty Goals",
		standard_pkatt: "Penalty Attempts",
		expected_xg: "xG",
		expected_npxg: "npxG",
		expected_xag: "xA",
		expected_npxg_sh: "npxG per Shot",
		expected_g_xg: "Goals minus xG",
		expected_np_g_xg: "Non-penalty Goals minus xG",
		performance_gls: "Goals",
		performance_ast: "Assists",
		performance_pk: "Penalty Goals",
		performance_pkatt: "Penalty Attempts",
		performance_sh: "Shots",
		performance_sot: "Shots on Target",
		performance_crdy: "Yellow Cards",
		performance_crdr: "Red Cards",
		performance_touches: "Touches",
		performance_tkl: "Tackles",
		performance_int: "Interceptions",
		performance_blocks: "Blocks",
		performance_fls: "Fouls Committed",
		performance_fld: "Fouls Drawn",
		performance_off: "Offsides",
		performance_crs: "Crosses",
		performance_tklw: "Tackles Won",
		performance_pkwon: "Penalties Won",
		performance_pkcon: "Penalties Conceded",
		performance_og: "Own Goals",
		performance_recov: "Ball Recoveries",
		performance_2crdy: "Second Yellow Cards",
		performance_sota: "Shots on Target Against",
		performance_ga: "Goals Against",
		performance_saves: "Saves",
		performance_save: "Save %",
		performance_cs: "Clean Sheets",
		performance_psxg: "Post-shot xG",
		performance_psxg_2: "PSxG per SoT",
		sca_sca: "Shot-Creating Actions",
		sca_gca: "Goal-Creating Actions",
		sca_types_sca: "Shot-Creating Actions",
		sca_types_passlive: "SCA from Live-ball Pass",
		sca_types_passdead: "SCA from Dead-ball Pass",
		sca_types_to: "SCA from Take-on",
		sca_types_sh: "SCA from Shot",
		sca_types_fld: "SCA from Foul Drawn",
		sca_types_def: "SCA from Defensive Action",
		gca_types_gca: "Goal-Creating Actions",
		gca_types_passlive: "GCA from Live-ball Pass",
		gca_types_passdead: "GCA from Dead-ball Pass",
		gca_types_to: "GCA from Take-on",
		gca_types_sh: "GCA from Shot",
		gca_types_fld: "GCA from Foul Drawn",
		gca_types_def: "GCA from Defensive Action",
		passes_cmp: "Passes Completed",
		passes_att: "Passes Attempted",
		passes_cmp_2: "Pass Completion %",
		passes_prgp: "Progressive Passes",
		total_cmp: "Passes Completed",
		total_att: "Passes Attempted",
		total_cmp_2: "Pass Completion %",
		total_totdist: "Total Pass Distance",
		total_prgdist: "Progressive Pass Distance",
		short_cmp: "Short Passes Completed",
		short_att: "Short Passes Attempted",
		short_cmp_2: "Short Pass Completion %",
		medium_cmp: "Medium Passes Completed",
		medium_att: "Medium Passes Attempted",
		medium_cmp_2: "Medium Pass Completion %",
		long_cmp: "Long Passes Completed",
		long_att: "Long Passes Attempted",
		long_cmp_2: "Long Pass Completion %",
		ast: "Assists",
		xag: "xAG",
		xa: "xA",
		kp: "Key Passes",
		"1_3": "Passes into Final Third",
		ppa: "Passes into Penalty Area",
		crspa: "Crosses into Penalty Area",
		prgp: "Progressive Passes",
		att: "Passes Attempted",
		pass_types_live: "Live-ball Passes",
		pass_types_dead: "Dead-ball Passes",
		pass_types_fk: "Free Kick Passes",
		pass_types_tb: "Through Balls",
		pass_types_sw: "Switches",
		pass_types_crs: "Crosses",
		pass_types_ti: "Throw-ins",
		pass_types_ck: "Corner Kicks",
		corner_kicks_in: "In-swinging Corners",
		corner_kicks_out: "Out-swinging Corners",
		corner_kicks_str: "Straight Corners",
		outcomes_cmp: "Completed Passes",
		outcomes_off: "Offside Passes",
		outcomes_blocks: "Blocked Passes",
		penalty_kicks_pkatt: "Penalties Faced",
		penalty_kicks_pka: "Penalties Allowed",
		penalty_kicks_pksv: "Penalties Saved",
		penalty_kicks_pkm: "Penalties Missed",
		launched_cmp: "Launches Completed",
		launched_att: "Launches Attempted",
		launched_cmp_2: "Launch Completion %",
		passes_att_gk: "Goalkeeper Passes Attempted",
		passes_thr: "Throws",
		passes_launch: "Launches",
		passes_avglen: "Avg Pass Length",
		goal_kicks_att: "Goal Kicks Attempted",
		goal_kicks_launch: "Goal Kicks Launched",
		goal_kicks_avglen: "Avg Goal Kick Length",
		crosses_opp: "Crosses Faced",
		crosses_stp: "Crosses Stopped",
		crosses_stp_2: "Crosses Stopped %",
		sweeper_opa: "Defensive Actions Outside Pen Area",
		sweeper_avgdist: "Avg Sweeper Distance",
		tackles_tkl: "Tackles",
		tackles_tklw: "Tackles Won",
		tackles_def_3rd: "Tackles in Def Third",
		tackles_mid_3rd: "Tackles in Mid Third",
		tackles_att_3rd: "Tackles in Att Third",
		challenges_tkl: "Dribbles Tackled",
		challenges_att: "Dribbles Challenged",
		challenges_tkl_2: "Dribbles Tackled %",
		challenges_lost: "Dribbles Bypassed",
		blocks_blocks: "Blocks",
		blocks_sh: "Shots Blocked",
		blocks_pass: "Passes Blocked",
		int: "Interceptions",
		tkl_int: "Tackles + Interceptions",
		clr: "Clearances",
		err: "Errors Leading to Shots",
		touches_touches: "Touches",
		touches_def_pen: "Touches in Def Pen Area",
		touches_def_3rd: "Touches in Def Third",
		touches_mid_3rd: "Touches in Mid Third",
		touches_att_3rd: "Touches in Att Third",
		touches_att_pen: "Touches in Att Pen Area",
		touches_live: "Live-ball Touches",
		take_ons_att: "Take-ons Attempted",
		take_ons_succ: "Take-ons Completed",
		take_ons_succ_2: "Take-on Success %",
		take_ons_tkld: "Tackled on Take-ons",
		take_ons_tkld_2: "Tackled on Take-ons %",
		carries_carries: "Carries",
		carries_totdist: "Total Carry Distance",
		carries_prgdist: "Progressive Carry Distance",
		carries_prgc: "Progressive Carries",
		carries_1_3: "Carries into Final Third",
		carries_cpa: "Carries into Pen Area",
		carries_mis: "Miscontrols",
		carries_dis: "Dispossessed",
		receiving_rec: "Passes Received",
		receiving_prgr: "Progressive Passes Received",
		aerial_duels_won: "Aerial Duels Won",
		aerial_duels_lost: "Aerial Duels Lost",
		aerial_duels_won_2: "Aerial Duels Won %"
	};

	const STAT_DESCRIPTIONS: Record<string, string> = {
		appearances: "Matches played.",
		matches: "Matches played.",
		min: "Minutes played.",
		minutes: "Minutes played.",
		points: "Total points earned.",
		wins: "Matches won.",
		draws: "Matches drawn.",
		losses: "Matches lost.",
		goals: "Goals scored.",
		assists: "Assists recorded.",
		goal_diff: "Goals for minus goals against.",
		goals_for: "Goals scored by the team.",
		goals_against: "Goals conceded.",
		gf: "Goals scored by the team.",
		ga: "Goals conceded.",
		xg: "Expected goals (xG).",
		xga: "Expected goals against (xGA).",
		npxg: "Non-penalty expected goals (npxG).",
		npxgd: "Non-penalty expected goals difference.",
		poss: "Share of possession.",
		attendance: "Match attendance.",
		standard_gls: "Goals scored.",
		standard_sh: "Shots taken.",
		standard_sot: "Shots on target.",
		standard_sot_2: "Shots on target percentage.",
		standard_g_sh: "Goals per shot.",
		standard_g_sot: "Goals per shot on target.",
		standard_dist: "Average shot distance.",
		standard_fk: "Shots from free kicks.",
		standard_pk: "Penalty goals scored.",
		standard_pkatt: "Penalty attempts.",
		expected_xg: "Expected goals (xG).",
		expected_npxg: "Non-penalty expected goals (npxG).",
		expected_xag: "Expected assists (xA).",
		expected_npxg_sh: "Non-penalty xG per shot.",
		expected_g_xg: "Goals minus expected goals.",
		expected_np_g_xg: "Non-penalty goals minus expected goals.",
		performance_gls: "Goals scored.",
		performance_ast: "Assists recorded.",
		performance_pk: "Penalty goals scored.",
		performance_pkatt: "Penalty kicks attempted.",
		performance_sh: "Shots taken.",
		performance_sot: "Shots on target.",
		performance_crdy: "Yellow cards.",
		performance_crdr: "Red cards.",
		performance_touches: "Touches recorded.",
		performance_tkl: "Tackles recorded.",
		performance_int: "Interceptions recorded.",
		performance_blocks: "Blocks recorded.",
		performance_fls: "Fouls committed.",
		performance_fld: "Fouls drawn.",
		performance_off: "Offsides recorded.",
		performance_crs: "Crosses attempted.",
		performance_tklw: "Tackles won.",
		performance_pkwon: "Penalties won.",
		performance_pkcon: "Penalties conceded.",
		performance_og: "Own goals.",
		performance_recov: "Ball recoveries.",
		performance_2crdy: "Second yellow cards.",
		performance_sota: "Shots on target faced.",
		performance_ga: "Goals conceded by the keeper.",
		performance_saves: "Saves made.",
		performance_save: "Save percentage.",
		performance_cs: "Clean sheets.",
		performance_psxg: "Post-shot expected goals faced.",
		performance_psxg_2: "Post-shot xG per shot on target.",
		sca_sca: "Shot-creating actions.",
		sca_gca: "Goal-creating actions.",
		sca_types_sca: "Shot-creating actions.",
		sca_types_passlive: "SCAs from live-ball passes.",
		sca_types_passdead: "SCAs from dead-ball passes.",
		sca_types_to: "SCAs from take-ons.",
		sca_types_sh: "SCAs from shots.",
		sca_types_fld: "SCAs from fouls drawn.",
		sca_types_def: "SCAs from defensive actions.",
		gca_types_gca: "Goal-creating actions.",
		gca_types_passlive: "GCAs from live-ball passes.",
		gca_types_passdead: "GCAs from dead-ball passes.",
		gca_types_to: "GCAs from take-ons.",
		gca_types_sh: "GCAs from shots.",
		gca_types_fld: "GCAs from fouls drawn.",
		gca_types_def: "GCAs from defensive actions.",
		passes_cmp: "Passes completed.",
		passes_att: "Passes attempted.",
		passes_cmp_2: "Pass completion percentage.",
		passes_prgp: "Progressive passes completed.",
		total_cmp: "Passes completed.",
		total_att: "Passes attempted.",
		total_cmp_2: "Pass completion percentage.",
		total_totdist: "Total pass distance.",
		total_prgdist: "Progressive pass distance.",
		short_cmp: "Short passes completed.",
		short_att: "Short passes attempted.",
		short_cmp_2: "Short pass completion percentage.",
		medium_cmp: "Medium passes completed.",
		medium_att: "Medium passes attempted.",
		medium_cmp_2: "Medium pass completion percentage.",
		long_cmp: "Long passes completed.",
		long_att: "Long passes attempted.",
		long_cmp_2: "Long pass completion percentage.",
		ast: "Assists recorded.",
		xag: "Expected assisted goals (xAG).",
		xa: "Expected assists (xA).",
		kp: "Key passes.",
		"1_3": "Passes into the final third.",
		ppa: "Passes into the penalty area.",
		crspa: "Crosses into the penalty area.",
		prgp: "Progressive passes completed.",
		att: "Passes attempted.",
		pass_types_live: "Live-ball passes.",
		pass_types_dead: "Dead-ball passes.",
		pass_types_fk: "Free kick passes.",
		pass_types_tb: "Through balls.",
		pass_types_sw: "Switches of play.",
		pass_types_crs: "Crosses.",
		pass_types_ti: "Throw-ins.",
		pass_types_ck: "Corner kicks taken.",
		corner_kicks_in: "In-swinging corners.",
		corner_kicks_out: "Out-swinging corners.",
		corner_kicks_str: "Straight corners.",
		outcomes_cmp: "Completed passes.",
		outcomes_off: "Offside passes.",
		outcomes_blocks: "Blocked passes.",
		penalty_kicks_pkatt: "Penalty kicks faced.",
		penalty_kicks_pka: "Penalty goals allowed.",
		penalty_kicks_pksv: "Penalties saved.",
		penalty_kicks_pkm: "Penalties missed by opponent.",
		launched_cmp: "Long passes completed by the keeper.",
		launched_att: "Long passes attempted by the keeper.",
		launched_cmp_2: "Long pass completion percentage.",
		passes_att_gk: "Goalkeeper passes attempted.",
		passes_thr: "Throws by the keeper.",
		passes_launch: "Launches by the keeper.",
		passes_avglen: "Average pass length.",
		goal_kicks_att: "Goal kicks attempted.",
		goal_kicks_launch: "Goal kicks launched.",
		goal_kicks_avglen: "Average goal kick length.",
		crosses_opp: "Crosses faced.",
		crosses_stp: "Crosses stopped.",
		crosses_stp_2: "Crosses stopped percentage.",
		sweeper_opa: "Defensive actions outside the penalty area.",
		sweeper_avgdist: "Average distance of defensive actions.",
		tackles_tkl: "Tackles made.",
		tackles_tklw: "Tackles won.",
		tackles_def_3rd: "Tackles in the defensive third.",
		tackles_mid_3rd: "Tackles in the middle third.",
		tackles_att_3rd: "Tackles in the attacking third.",
		challenges_tkl: "Dribblers tackled.",
		challenges_att: "Dribblers challenged.",
		challenges_tkl_2: "Dribblers tackled percentage.",
		challenges_lost: "Dribbles completed against.",
		blocks_blocks: "Blocks recorded.",
		blocks_sh: "Shots blocked.",
		blocks_pass: "Passes blocked.",
		int: "Interceptions recorded.",
		tkl_int: "Tackles plus interceptions.",
		clr: "Clearances.",
		err: "Errors leading to shots.",
		touches_touches: "Touches recorded.",
		touches_def_pen: "Touches in defensive penalty area.",
		touches_def_3rd: "Touches in defensive third.",
		touches_mid_3rd: "Touches in middle third.",
		touches_att_3rd: "Touches in attacking third.",
		touches_att_pen: "Touches in attacking penalty area.",
		touches_live: "Live-ball touches.",
		take_ons_att: "Take-ons attempted.",
		take_ons_succ: "Successful take-ons.",
		take_ons_succ_2: "Take-on success percentage.",
		take_ons_tkld: "Tackled during take-ons.",
		take_ons_tkld_2: "Tackled percentage on take-ons.",
		carries_carries: "Carries recorded.",
		carries_totdist: "Total carry distance.",
		carries_prgdist: "Progressive carry distance.",
		carries_prgc: "Progressive carries.",
		carries_1_3: "Carries into the final third.",
		carries_cpa: "Carries into the penalty area.",
		carries_mis: "Miscontrols.",
		carries_dis: "Times dispossessed.",
		receiving_rec: "Passes received.",
		receiving_prgr: "Progressive passes received.",
		aerial_duels_won: "Aerial duels won.",
		aerial_duels_lost: "Aerial duels lost.",
		aerial_duels_won_2: "Aerial duels won percentage."
	};

	const statLabel = (key: string) => STAT_LABELS[key] ?? formatKey(key);
	const statDescription = (key: string) =>
		STAT_DESCRIPTIONS[key] ?? `Definition unavailable for ${statLabel(key)}.`;

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

	const pickNumber = (totals: Record<string, number | null>, keys: string[]) => {
		for (const key of keys) {
			const value = totals[key];
			if (typeof value === "number" && !Number.isNaN(value)) {
				return value;
			}
		}
		return null;
	};

	const scaleTotals = (
		totals: Record<string, number | null>,
		mode: StatMode,
		perGameDenom: number | null,
		per90Denom: number | null,
		exclude: Set<string>
	) => {
		if (mode === "total") {
			return totals;
		}

		const output: Record<string, number | null> = {};
		const perGame = perGameDenom && perGameDenom > 0 ? perGameDenom : null;
		const per90Base =
			per90Denom && per90Denom > 0 ? per90Denom : perGame ? perGame * 90 : null;

		for (const [key, value] of Object.entries(totals)) {
			if (exclude.has(key) || value === null || value === undefined) {
				output[key] = value;
				continue;
			}
			if (typeof value !== "number" || Number.isNaN(value)) {
				output[key] = value;
				continue;
			}
			if (mode === "per-game") {
				output[key] = perGame ? value / perGame : value;
				continue;
			}
			if (mode === "per-90") {
				output[key] = per90Base ? (value / per90Base) * 90 : value;
				continue;
			}
			output[key] = value;
		}

		return output;
	};

	const sortedEntries = (totals: Record<string, number | null>) =>
		Object.entries(totals).sort(([a], [b]) => a.localeCompare(b));

	$: {
		if (playerData) {
			const appearances = pickNumber(playerData.totals, ["appearances"]);
			const minutes = pickNumber(playerData.totals, ["min", "minutes"]);
			const exclude = new Set(["appearances", "min", "minutes"]);
			playerTotalsView = scaleTotals(playerData.totals, playerMode, appearances, minutes, exclude);
			playerByTeamView = playerData.byTeam.map((row) => {
				const scaled = scaleTotals(
					{
						appearances: row.appearances,
						minutes: row.minutes,
						goals: row.goals,
						assists: row.assists
					},
					playerMode,
					row.appearances ?? null,
					row.minutes ?? null,
					new Set(["appearances", "minutes"])
				);
				return { ...row, scaled };
			});
		} else {
			playerTotalsView = {};
			playerByTeamView = [];
		}
	}

	$: {
		if (teamData) {
			const matches = pickNumber(teamData.totals, ["matches"]);
			const scheduleStats = teamData.stats?.schedule ?? {};
			const minutes = pickNumber(scheduleStats, ["min", "minutes"]);
			const exclude = new Set(["matches", "min", "minutes"]);
			teamTotalsView = scaleTotals(teamData.totals, teamMode, matches, minutes, exclude);
			teamStatsView = Object.fromEntries(
				Object.entries(teamData.stats).map(([category, totals]) => {
					if (!totals) {
						return [category, null];
					}
					const scaled = scaleTotals(totals, teamMode, matches, minutes, exclude);
					return [category, scaled];
				})
			);
		} else {
			teamTotalsView = {};
			teamStatsView = {};
		}
	}

	onMount(() => {
		const handleClick = (event: MouseEvent) => {
			const target = event.target as Node;
			if (playerBox && !playerBox.contains(target)) {
				playerDropdownOpen = false;
			}
			if (teamBox && !teamBox.contains(target)) {
				teamDropdownOpen = false;
			}
		};

		document.addEventListener("click", handleClick);

		const loadOptions = async () => {
			optionsLoading = true;
			optionsError = "";
			try {
				const [playersResponse, teamsResponse] = await Promise.all([
					authFetch("/api/players/all"),
					authFetch("/api/teams/all")
				]);

				if (!playersResponse.ok || !teamsResponse.ok) {
					optionsError = "Failed to load dropdown options.";
					return;
				}

				const playersData = (await playersResponse.json()) as { players: string[] };
				const teamsData = (await teamsResponse.json()) as { teams: string[] };

				playerOptions = makeOptions(playersData.players ?? []);
				teamOptions = makeOptions(teamsData.teams ?? []);
			} catch (err) {
				optionsError = err instanceof Error ? err.message : "Failed to load dropdown options.";
			} finally {
				optionsLoading = false;
			}
		};

		const bootstrap = async () => {
			authError = "";
			authReady = false;
			const path = window.location.pathname;
			if (authBypass) {
				authReady = true;
				await loadOptions();
				return;
			}
			if (path === "/login" || path === "/signup" || path === "/logout" || path === "/auth/callback") {
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
				await loadOptions();
			} catch (err) {
				authError = err instanceof Error ? err.message : "Auth check failed.";
			}
		};

		void bootstrap();

		return () => {
			document.removeEventListener("click", handleClick);
		};
	});

	const loadPlayer = async () => {
		resetErrors();
		playerData = null;
		if (!playerSlug) {
			playerError = "Enter a player name.";
			return;
		}
		if (!authReady) {
			playerError = "Please log in to load player stats.";
			return;
		}
		playerLoading = true;
		try {
			const response = await authFetch(`/api/player/${playerSlug}`);
			if (!response.ok) {
				playerError = await readError(response);
				return;
			}
			playerData = (await response.json()) as PlayerPayload;
		} catch (err) {
			playerError = err instanceof Error ? err.message : "Failed to load player data.";
		} finally {
			playerLoading = false;
		}
	};

	const loadTeam = async () => {
		resetErrors();
		teamData = null;
		if (!teamSlug) {
			teamError = "Enter a team name.";
			return;
		}
		if (!authReady) {
			teamError = "Please log in to load team stats.";
			return;
		}
		teamLoading = true;
		try {
			const response = await authFetch(`/api/team/${teamSlug}`);
			if (!response.ok) {
				teamError = await readError(response);
				return;
			}
			teamData = (await response.json()) as TeamPayload;
		} catch (err) {
			teamError = err instanceof Error ? err.message : "Failed to load team data.";
		} finally {
			teamLoading = false;
		}
	};

	const loadExample = () => {
		playerQuery = "Bruno Fernandes";
		teamQuery = "Manchester United";
	};
</script>

<svelte:head>
	<title>fbsts</title>
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
			<a class="ghost logout-link" href="/logout">Log out</a>
		</div>
		<header class="hero reveal" style="--delay: 0s">
			<p class="eyebrow">FBSTS data layer</p>
			<h1>Premier League 2024-25 stats (previous seasons soon)</h1>
			<div class="hero-actions">
				<button class="primary" type="button" on:click={loadExample}>Load example queries</button>
				<div class="hint">Slugs auto-generate as you type.</div>
			</div>
		</header>
		{#if authError}
			<p class="error">{authError}</p>
		{/if}

		<section class="grid">
			<article class="card reveal" style="--delay: 0.1s">
				<header>
					<h2>Player snapshot</h2>
					<p>Totals and team splits.</p>
				</header>
			<form on:submit|preventDefault={loadPlayer}>
				<div
					class="input-group"
					bind:this={playerBox}
					on:focusin={() => (playerDropdownOpen = true)}
				>
					<label>
						Player name
						<input
							type="text"
							placeholder="Bruno Fernandes"
							bind:value={playerQuery}
							on:input={() => (playerDropdownOpen = true)}
						/>
					</label>
					{#if playerDropdownOpen}
						<div class="dropdown">
							{#if optionsLoading}
								<div class="dropdown-item muted">Loading options...</div>
							{:else if optionsError}
								<div class="dropdown-item muted">{optionsError}</div>
							{:else if playerMatches.length === 0}
								<div class="dropdown-item muted">No matches found.</div>
							{:else}
								{#each playerMatches as option}
									<button
										class="dropdown-item"
										type="button"
										on:click={() => selectPlayer(option.name)}
									>
										{option.name}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
				<div class="slug">
					Slug:
					{#if playerSlug}
						<a class="slug-link" href={playerSlugHref}>
							<code>{playerSlug}</code>
						</a>
					{:else}
						<code>player-slug</code>
					{/if}
				</div>
				<div class="action-row">
					<label class="mode-select">
						Mode
						<select bind:value={playerMode}>
							<option value="total">Total</option>
							<option value="per-game">Per game</option>
							<option value="per-90">Per 90</option>
						</select>
					</label>
					<button class="ghost" type="submit" disabled={playerLoading}>
						{playerLoading ? "Loading..." : "Fetch player stats"}
					</button>
				</div>
			</form>
			{#if playerError}
				<p class="error">{playerError}</p>
			{:else if playerData}
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
				<div class="section">
					<h3>By team</h3>
					<ul class="list">
						{#each playerByTeamView as row}
							<li>
								<span>{row.team || "Unknown"}</span>
								<span>
									{formatValue(row.scaled.goals ?? row.goals)}
									<abbr class="stat-label" title={statDescription("goals")}>
										{statLabel("goals")}
									</abbr>
								</span>
							</li>
						{/each}
					</ul>
				</div>
				<div class="section">
					<h3>All stats</h3>
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
				</div>
			{/if}
		</article>

		<article class="card reveal" style="--delay: 0.2s">
			<header>
				<h2>Team totals</h2>
				<p>Wins, losses, and goal diff.</p>
			</header>
			<form on:submit|preventDefault={loadTeam}>
				<div class="input-group" bind:this={teamBox} on:focusin={() => (teamDropdownOpen = true)}>
					<label>
						Team name
						<input
							type="text"
							placeholder="Manchester United"
							bind:value={teamQuery}
							on:input={() => (teamDropdownOpen = true)}
						/>
					</label>
					{#if teamDropdownOpen}
						<div class="dropdown">
							{#if optionsLoading}
								<div class="dropdown-item muted">Loading options...</div>
							{:else if optionsError}
								<div class="dropdown-item muted">{optionsError}</div>
							{:else if teamMatches.length === 0}
								<div class="dropdown-item muted">No matches found.</div>
							{:else}
								{#each teamMatches as option}
									<button
										class="dropdown-item"
										type="button"
										on:click={() => selectTeam(option.name)}
									>
										{option.name}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
				<div class="slug">
					Slug:
					{#if teamSlug}
						<a class="slug-link" href={teamSlugHref}>
							<code>{teamSlug}</code>
						</a>
					{:else}
						<code>team-slug</code>
					{/if}
				</div>
				<div class="action-row">
					<label class="mode-select">
						Mode
						<select bind:value={teamMode}>
							<option value="total">Total</option>
							<option value="per-game">Per game</option>
						</select>
					</label>
					<button class="ghost" type="submit" disabled={teamLoading}>
						{teamLoading ? "Loading..." : "Fetch team totals"}
					</button>
				</div>
			</form>
			{#if teamError}
				<p class="error">{teamError}</p>
			{:else if teamData}
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
				<div class="section">
					<h3>All stats</h3>
					{#each Object.entries(teamStatsView) as [category, totals]}
						{#if totals}
							<div class="stats-section">
								<h4>{formatKey(category)}</h4>
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
				</div>
			{/if}
			</article>

		</section>

	<footer class="foot reveal" style="--delay: 0.35s">
		<a class="github-button" href="https://github.com/shrinikets/fbsts" target="_blank" rel="noreferrer">
			<svg class="github-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
				<path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
				/>
			</svg>
		</a>
		<div class="copyright">© 2026 Shriniket Sivakumar</div>
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

	.hero {
		max-width: 840px;
		margin-bottom: 40px;
	}

	.top-bar {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 16px;
	}

	.logout-link {
		align-self: flex-start;
	}

	.auth-gate {
		min-height: 100vh;
		display: grid;
		place-items: center;
		text-align: center;
		padding: 64px 8vw 72px;
		color: #6c5f52;
	}

	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.25em;
		font-size: 12px;
		font-weight: 600;
		color: #6c5f52;
	}

	h1,
	h2 {
		font-family: "Fraunces", "Georgia", serif;
		margin: 0 0 12px;
	}

	h1 {
		font-size: clamp(2.4rem, 4vw, 3.4rem);
		line-height: 1.05;
	}

	.tagline {
		font-size: 1.05rem;
		max-width: 620px;
		color: #4b3e34;
	}

	.hero-actions {
		margin-top: 24px;
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: center;
	}

	button {
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
		transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
	}

	.ghost:hover {
		background: #f1e8dc;
		border-color: #cbbca9;
		transform: translateY(-1px);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
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
		min-height: 320px;
	}

	.card header p {
		margin: 0;
		color: #6c5f52;
	}

	form {
		display: grid;
		gap: 12px;
	}

	label {
		display: grid;
		gap: 6px;
		font-weight: 600;
		color: #3f342b;
	}

	.input-group {
		position: relative;
	}

	.action-row {
		display: flex;
		gap: 12px;
		align-items: flex-end;
		flex-wrap: wrap;
	}

	.mode-select {
		display: grid;
		gap: 6px;
		font-weight: 600;
		color: #3f342b;
	}

	input {
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid #d8ccbc;
		background: #fff;
		font: inherit;
		color: inherit;
	}

	select {
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid #d8ccbc;
		background: #fff;
		font: inherit;
		color: inherit;
	}

	.dropdown {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(100% + 6px);
		z-index: 30;
		background: #fffaf3;
		border: 1px solid #d8ccbc;
		border-radius: 14px;
		padding: 6px;
		max-height: 240px;
		overflow-y: auto;
		box-shadow: 0 16px 28px rgba(38, 28, 20, 0.18);
	}

	.dropdown-item {
		width: 100%;
		text-align: left;
		padding: 8px 10px;
		border-radius: 10px;
		background: transparent;
		border: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.dropdown-item:hover {
		background: #f1e8dc;
	}

	.dropdown-item.muted {
		cursor: default;
		color: #6c5f52;
	}

	.slug {
		font-size: 0.9rem;
		color: #6c5f52;
	}

	code {
		font-family: "Space Grotesk", "Segoe UI", sans-serif;
		background: rgba(15, 107, 79, 0.08);
		padding: 2px 6px;
		border-radius: 6px;
	}

	.slug-link {
		color: inherit;
		text-decoration: none;
	}

	.slug-link:hover {
		text-decoration: underline;
	}

	.stat-label {
		text-decoration: underline dotted;
		text-underline-offset: 3px;
		text-decoration-color: #b19f8e;
		cursor: help;
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

	.section {
		display: grid;
		gap: 10px;
	}

	.section h3 {
		margin: 8px 0 0;
		font-size: 1rem;
		color: #3f342b;
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

	.stats-section h4 {
		margin: 0;
		font-size: 0.9rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
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

	.hint {
		font-size: 0.9rem;
		color: #6c5f52;
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

	.copyright {
		font-size: 0.9rem;
		color: #6c5f52;
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

	@media (max-width: 700px) {
		.page {
			padding: 40px 6vw 64px;
		}

		.card {
			min-height: auto;
		}

		.hero-actions {
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
