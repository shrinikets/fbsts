import { json } from "@sveltejs/kit";

import { db } from "$lib/server/db";

import type { RequestHandler } from "./$types";

const DEFAULT_SEASON = "2024-2025";
const DEFAULT_COMPETITION = "ENG-Premier League";
const DEFAULT_LIMIT = 10;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const cacheHeaders = {
	"Cache-Control": "private, max-age=60, stale-while-revalidate=300",
	Vary: "Authorization"
};

const getColumns = async (table: string) => {
	const result = await db.query<{ column_name: string }>(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1`,
		[table]
	);
	return new Set(result.rows.map((row) => row.column_name));
};

const pickColumn = async (table: string, candidates: string[]) => {
	const columns = await getColumns(table);
	for (const candidate of candidates) {
		if (columns.has(candidate)) {
			return candidate;
		}
	}
	return null;
};

const buildFilters = (
	columns: Set<string>,
	season: string,
	competition: string,
	includeCompetition: boolean
) => {
	const clauses: string[] = [];
	const params: string[] = [];

	if (columns.has("season")) {
		params.push(season);
		clauses.push(`season = $${params.length}`);
	}
	if (includeCompetition && columns.has("competition")) {
		params.push(competition);
		clauses.push(`competition = $${params.length}`);
	}

	return {
		where: clauses.length ? clauses.join(" AND ") : "TRUE",
		params
	};
};

const fetchStandings = async (season: string, competition: string) => {
	const columns = await getColumns("team_match_stats");
	const baseSql = `
		SELECT
			team,
			COUNT(*)::int AS played,
			SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END)::int AS wins,
			SUM(CASE WHEN result = 'D' THEN 1 ELSE 0 END)::int AS draws,
			SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END)::int AS losses,
			SUM(COALESCE(goals_for, 0))::int AS gf,
			SUM(COALESCE(goals_against, 0))::int AS ga,
			SUM(COALESCE(goals_for, 0) - COALESCE(goals_against, 0))::int AS gd,
			SUM(CASE WHEN result = 'W' THEN 3 WHEN result = 'D' THEN 1 ELSE 0 END)::int AS pts
		FROM team_match_stats
		WHERE %WHERE%
		GROUP BY team
		ORDER BY pts DESC, gd DESC, gf DESC, team ASC
	`;

	const primary = buildFilters(columns, season, competition, true);
	const result = await db.query<{
		team: string;
		played: number;
		wins: number;
		draws: number;
		losses: number;
		gf: number;
		ga: number;
		gd: number;
		pts: number;
	}>(
		`${baseSql.replace("%WHERE%", primary.where)} LIMIT 50`,
		primary.params
	);

	const hasSeason = columns.has("season");
	const hasCompetition = columns.has("competition");
	if (result.rowCount > 0 || !hasSeason || !hasCompetition) {
		return result.rows;
	}

	const fallback = buildFilters(columns, season, competition, false);
	const fallbackResult = await db.query<typeof result.rows[0]>(
		`${baseSql.replace("%WHERE%", fallback.where)} LIMIT 50`,
		fallback.params
	);
	return fallbackResult.rows;
};

const fetchSchedule = async (season: string, competition: string, limit: number) => {
	const columns = await getColumns("matches");
	const matchDateColumn = await pickColumn("matches", ["match_date", "date"]);
	if (!matchDateColumn) {
		return [];
	}
	const matchDateExpr = `m.${quoteIdent(matchDateColumn)}`;
	const primary = buildFilters(columns, season, competition, true);
	const sql = `
		SELECT ${matchDateExpr}::text AS match_date, m.home_team, m.away_team
		FROM matches m
		WHERE ${primary.where} AND ${matchDateExpr} >= CURRENT_DATE
		ORDER BY ${matchDateExpr} ASC
		LIMIT $${primary.params.length + 1}
	`;

	const result = await db.query<{
		match_date: string | null;
		home_team: string | null;
		away_team: string | null;
	}>(sql, [...primary.params, limit]);

	const hasSeason = columns.has("season");
	const hasCompetition = columns.has("competition");
	if (result.rowCount > 0 || !hasSeason || !hasCompetition) {
		return result.rows;
	}

	const fallback = buildFilters(columns, season, competition, false);
	const fallbackSql = `
		SELECT ${matchDateExpr}::text AS match_date, m.home_team, m.away_team
		FROM matches m
		WHERE ${fallback.where} AND ${matchDateExpr} >= CURRENT_DATE
		ORDER BY ${matchDateExpr} ASC
		LIMIT $${fallback.params.length + 1}
	`;
	const fallbackResult = await db.query<typeof result.rows[0]>(fallbackSql, [
		...fallback.params,
		limit
	]);
	return fallbackResult.rows;
};

const fetchLeaderboard = async (
	table: string,
	column: string,
	season: string,
	competition: string,
	limit: number,
	castType = "int"
) => {
	const columns = await getColumns(table);
	const primary = buildFilters(columns, season, competition, true);
	const sql = `
		SELECT player, SUM(COALESCE(${quoteIdent(column)}, 0))::${castType} AS value
		FROM ${quoteIdent(table)}
		WHERE ${primary.where}
		GROUP BY player
		ORDER BY value DESC, player ASC
		LIMIT $${primary.params.length + 1}
	`;

	const result = await db.query<{ player: string; value: number }>(sql, [
		...primary.params,
		limit
	]);
	const hasSeason = columns.has("season");
	const hasCompetition = columns.has("competition");
	if (result.rowCount > 0 || !hasSeason || !hasCompetition) {
		return result.rows;
	}

	const fallback = buildFilters(columns, season, competition, false);
	const fallbackSql = `
		SELECT player, SUM(COALESCE(${quoteIdent(column)}, 0))::${castType} AS value
		FROM ${quoteIdent(table)}
		WHERE ${fallback.where}
		GROUP BY player
		ORDER BY value DESC, player ASC
		LIMIT $${fallback.params.length + 1}
	`;
	const fallbackResult = await db.query<{ player: string; value: number }>(fallbackSql, [
		...fallback.params,
		limit
	]);
	return fallbackResult.rows;
};

const findStatSource = async (
	candidates: { table: string; columns: string[] }[]
): Promise<{ table: string; column: string } | null> => {
	for (const candidate of candidates) {
		const column = await pickColumn(candidate.table, candidate.columns);
		if (column) {
			return { table: candidate.table, column };
		}
	}
	return null;
};

const findTeamStatSource = async (
	candidates: { table: string; columns: string[] }[]
): Promise<{ table: string; column: string; teamColumn: string | null } | null> => {
	for (const candidate of candidates) {
		const columns = await getColumns(candidate.table);
		const column = await pickColumn(candidate.table, candidate.columns);
		if (!column) {
			continue;
		}
		const teamColumn = columns.has("team") ? "team" : columns.has("squad") ? "squad" : null;
		if (!teamColumn) {
			continue;
		}
		return { table: candidate.table, column, teamColumn };
	}
	return null;
};

const fetchTeamXgTotals = async (season: string, competition: string) => {
	const source = await findTeamStatSource([
		{ table: "fbref_team_match_shooting", columns: ["expected_xg", "xg", "npxg"] },
		{ table: "fbref_team_match_schedule", columns: ["expected_xg", "xg", "npxg", "xg_for"] }
	]);
	if (!source) {
		return new Map<string, number>();
	}
	const columns = await getColumns(source.table);
	const primary = buildFilters(columns, season, competition, true);
	const sql = `
		SELECT ${quoteIdent(source.teamColumn)} AS team,
		       SUM(COALESCE(${quoteIdent(source.column)}, 0))::double precision AS xg
		FROM ${quoteIdent(source.table)}
		WHERE ${primary.where}
		GROUP BY ${quoteIdent(source.teamColumn)}
	`;
	const result = await db.query<{ team: string; xg: number }>(sql, primary.params);
	const hasSeason = columns.has("season");
	const hasCompetition = columns.has("competition");
	if (result.rowCount > 0 || !hasSeason || !hasCompetition) {
		return new Map(result.rows.map((row) => [row.team, row.xg]));
	}
	const fallback = buildFilters(columns, season, competition, false);
	const fallbackResult = await db.query<{ team: string; xg: number }>(
		`
		SELECT ${quoteIdent(source.teamColumn)} AS team,
		       SUM(COALESCE(${quoteIdent(source.column)}, 0))::double precision AS xg
		FROM ${quoteIdent(source.table)}
		WHERE ${fallback.where}
		GROUP BY ${quoteIdent(source.teamColumn)}
		`,
		fallback.params
	);
	return new Map(fallbackResult.rows.map((row) => [row.team, row.xg]));
};

const fetchTeamForm = async (season: string, competition: string) => {
	const matchDateColumn = await pickColumn("matches", ["match_date", "date"]);
	const matchDateExpr = matchDateColumn ? `m.${quoteIdent(matchDateColumn)}` : "m.game_id";
	const teamColumns = await getColumns("team_match_stats");
	const primary = buildFilters(teamColumns, season, competition, true);
	const sql = `
		WITH ranked AS (
			SELECT
				t.team,
				t.result,
				${matchDateExpr} AS match_order,
				ROW_NUMBER() OVER (PARTITION BY t.team ORDER BY ${matchDateExpr} DESC) AS rn
			FROM team_match_stats t
			JOIN matches m ON t.game_id = m.game_id
			WHERE ${primary.where}
		)
		SELECT team, STRING_AGG(result, '-' ORDER BY match_order DESC) AS form
		FROM ranked
		WHERE rn <= 5
		GROUP BY team
	`;
	const result = await db.query<{ team: string; form: string | null }>(sql, primary.params);
	const hasSeason = teamColumns.has("season");
	const hasCompetition = teamColumns.has("competition");
	if (result.rowCount > 0 || !hasSeason || !hasCompetition) {
		return new Map(result.rows.map((row) => [row.team, row.form ?? null]));
	}
	const fallback = buildFilters(teamColumns, season, competition, false);
	const fallbackResult = await db.query<{ team: string; form: string | null }>(
		`
		WITH ranked AS (
			SELECT
				t.team,
				t.result,
				${matchDateExpr} AS match_order,
				ROW_NUMBER() OVER (PARTITION BY t.team ORDER BY ${matchDateExpr} DESC) AS rn
			FROM team_match_stats t
			JOIN matches m ON t.game_id = m.game_id
			WHERE ${fallback.where}
		)
		SELECT team, STRING_AGG(result, '-' ORDER BY match_order DESC) AS form
		FROM ranked
		WHERE rn <= 5
		GROUP BY team
		`,
		fallback.params
	);
	return new Map(fallbackResult.rows.map((row) => [row.team, row.form ?? null]));
};

export const GET: RequestHandler = async ({ url }) => {
	const season = url.searchParams.get("season") ?? DEFAULT_SEASON;
	const competition = url.searchParams.get("competition") ?? DEFAULT_COMPETITION;
	const limitParam = Number(url.searchParams.get("limit"));
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT;
	const includeDetails = url.searchParams.get("details") === "1";

	const [standings, schedule] = await Promise.all([
		fetchStandings(season, competition),
		fetchSchedule(season, competition, limit)
	]);

	const goalsColumn = await pickColumn("player_match_stats", ["goals"]);
	const assistsColumn = await pickColumn("player_match_stats", ["assists"]);
	const tacklesColumn = await pickColumn("fbref_player_match_defense", [
		"tkl",
		"tackles_tkl",
		"performance_tkl"
	]);
	const yellowSource = await findStatSource([
		{ table: "fbref_player_match_summary", columns: ["performance_crdy", "crdy"] },
		{ table: "fbref_player_match_misc", columns: ["performance_crdy", "crdy"] }
	]);
	const redSource = await findStatSource([
		{ table: "fbref_player_match_summary", columns: ["performance_crdr", "crdr"] },
		{ table: "fbref_player_match_misc", columns: ["performance_crdr", "crdr"] }
	]);
	const xgSource = await findStatSource([
		{ table: "fbref_player_match_summary", columns: ["expected_xg", "xg", "npxg"] },
		{ table: "fbref_player_match_shooting", columns: ["expected_xg", "xg", "npxg"] }
	]);

	const [goals, assists, yellows, reds, tackles, xg] = await Promise.all([
		goalsColumn
			? fetchLeaderboard("player_match_stats", goalsColumn, season, competition, limit)
			: Promise.resolve([]),
		assistsColumn
			? fetchLeaderboard("player_match_stats", assistsColumn, season, competition, limit)
			: Promise.resolve([]),
		yellowSource
			? fetchLeaderboard(
					yellowSource.table,
					yellowSource.column,
					season,
					competition,
					limit
				)
			: Promise.resolve([]),
		redSource
			? fetchLeaderboard(redSource.table, redSource.column, season, competition, limit)
			: Promise.resolve([]),
		tacklesColumn
			? fetchLeaderboard("fbref_player_match_defense", tacklesColumn, season, competition, limit)
			: Promise.resolve([]),
		xgSource
			? fetchLeaderboard(
					xgSource.table,
					xgSource.column,
					season,
					competition,
					limit,
					"double precision"
				)
			: Promise.resolve([])
	]);

	let standingsRows = standings;
	if (includeDetails) {
		const [xgTotals, formTotals] = await Promise.all([
			fetchTeamXgTotals(season, competition),
			fetchTeamForm(season, competition)
		]);
		standingsRows = standings.map((row) => ({
			...row,
			xg: xgTotals.get(row.team) ?? null,
			form: formTotals.get(row.team) ?? null
		}));
	}

	return json(
		{
			season,
			competition,
			standings: standingsRows,
			schedule,
			leaderboards: {
				goals,
				assists,
				yellows,
				reds,
				tackles,
				xg
			}
		},
		{ headers: cacheHeaders }
	);
};
