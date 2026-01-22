import { error, json } from "@sveltejs/kit";

import { db } from "$lib/server/db";
import { slugSql } from "$lib/server/slug";
import { parseStatMode, scaleTotals, sumTable } from "$lib/server/stats";
import { teamNameOptions } from "$lib/server/team-names";

import type { RequestHandler } from "./$types";

const DEFAULT_SEASON = "2024-2025";
const DEFAULT_COMPETITION = "ENG-Premier League";

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

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

const getColumns = async (table: string) => {
	const result = await db.query<{ column_name: string }>(
		`SELECT column_name
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1`,
		[table]
	);
	return new Set(result.rows.map((row) => row.column_name));
};

const tableExists = async (table: string) => {
	const result = await db.query<{ name: string | null }>(
		"SELECT to_regclass($1) AS name",
		[`public.${table}`]
	);
	return Boolean(result.rows[0]?.name);
};

const pickColumnFromSet = (columns: Set<string>, candidates: string[]) => {
	for (const candidate of candidates) {
		if (columns.has(candidate)) {
			return candidate;
		}
	}
	return null;
};

const buildFiltersWithOffset = (
	columns: Set<string>,
	season: string,
	competition: string,
	includeCompetition: boolean,
	startIndex = 1
) => {
	const clauses: string[] = [];
	const params: string[] = [];
	let index = startIndex;

	if (columns.has("season")) {
		params.push(season);
		clauses.push(`season = $${index}`);
		index += 1;
	}
	if (includeCompetition && columns.has("competition")) {
		params.push(competition);
		clauses.push(`competition = $${index}`);
		index += 1;
	}

	return {
		where: clauses.length ? clauses.join(" AND ") : "TRUE",
		params
	};
};

const buildTeamFilters = (
	columns: Set<string>,
	teamNames: string[],
	season: string,
	competition: string
) => {
	const filters = buildFiltersWithOffset(columns, season, competition, true, 2);
	return {
		whereSql: `team = ANY($1) AND ${filters.where}`,
		params: [teamNames, ...filters.params]
	};
};

const buildMatchFilters = (
	columns: Set<string>,
	teamNames: string[],
	season: string,
	competition: string
) => {
	const clauses: string[] = ["(m.home_team = ANY($1) OR m.away_team = ANY($1))"];
	const params: unknown[] = [teamNames];
	let index = 2;

	if (columns.has("season")) {
		params.push(season);
		clauses.push(`m.season = $${index}`);
		index += 1;
	}
	if (columns.has("competition")) {
		params.push(competition);
		clauses.push(`m.competition = $${index}`);
		index += 1;
	}
	return {
		whereSql: clauses.join(" AND "),
		params
	};
};

const buildScorerFilters = (
	columns: Set<string>,
	matchIds: string[],
	season: string,
	competition: string
) => {
	const filters = buildFiltersWithOffset(columns, season, competition, true, 2);
	return {
		whereSql: `game_id = ANY($1) AND ${filters.where}`,
		params: [matchIds, ...filters.params]
	};
};

export const GET: RequestHandler = async ({ params, url }) => {
	const slug = params.slug.trim().toLowerCase();
	const mode = parseStatMode(url.searchParams.get("mode"));
	const season = url.searchParams.get("season") ?? DEFAULT_SEASON;
	const competition = url.searchParams.get("competition") ?? DEFAULT_COMPETITION;

	let teamName: string | null = null;
	if (await tableExists("teams")) {
		const teamResult = await db.query<{ name: string }>(
			`SELECT name
			 FROM teams
			 WHERE ${slugSql("name")} = $1
			 LIMIT 1`,
			[slug]
		);
		teamName = teamResult.rows[0]?.name ?? null;
	}

	if (!teamName && (await tableExists("team_match_stats"))) {
		const teamResult = await db.query<{ name: string }>(
			`SELECT team AS name
			 FROM team_match_stats
			 WHERE ${slugSql("team")} = $1
			 LIMIT 1`,
			[slug]
		);
		teamName = teamResult.rows[0]?.name ?? null;
	}

	if (!teamName) {
		throw error(404, "Team not found");
	}
	const teamNames = teamNameOptions(teamName);
	const teamMatchColumns = await getColumns("team_match_stats");
	const teamFilters = buildTeamFilters(teamMatchColumns, teamNames, season, competition);
	const goalsForColumn = pickColumnFromSet(teamMatchColumns, ["goals_for", "gf", "goals"]);
	const goalsAgainstColumn = pickColumnFromSet(teamMatchColumns, [
		"goals_against",
		"ga",
		"goals_allowed"
	]);
	const resultColumn = pickColumnFromSet(teamMatchColumns, ["result"]);

	if (!(await tableExists("team_match_stats"))) {
		return json({
			team: teamName,
			mode,
			totals: {},
			stats: {},
			matches: []
		});
	}

	const totalsResult = await db.query<{
		matches: number;
		wins: number;
		draws: number;
		losses: number;
		goals_for: number;
		goals_against: number;
		goal_diff: number;
		points: number;
	}>(
		`SELECT
			COUNT(*)::int AS matches,
			${resultColumn ? "SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END)::int" : "NULL::int"} AS wins,
			${resultColumn ? "SUM(CASE WHEN result = 'D' THEN 1 ELSE 0 END)::int" : "NULL::int"} AS draws,
			${resultColumn ? "SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END)::int" : "NULL::int"} AS losses,
			${
				goalsForColumn
					? `SUM(COALESCE(${quoteIdent(goalsForColumn)}, 0))::int`
					: "NULL::int"
			} AS goals_for,
			${
				goalsAgainstColumn
					? `SUM(COALESCE(${quoteIdent(goalsAgainstColumn)}, 0))::int`
					: "NULL::int"
			} AS goals_against,
			${
				goalsForColumn && goalsAgainstColumn
					? `SUM(COALESCE(${quoteIdent(goalsForColumn)}, 0) - COALESCE(${quoteIdent(
							goalsAgainstColumn
						)}, 0))::int`
					: "NULL::int"
			} AS goal_diff,
			${
				resultColumn
					? "SUM(CASE WHEN result = 'W' THEN 3 WHEN result = 'D' THEN 1 ELSE 0 END)::int"
					: "NULL::int"
			} AS points
		 FROM team_match_stats
		 WHERE ${teamFilters.whereSql}`,
		teamFilters.params
	);

	const statTables = [
		"schedule",
		"shooting",
		"keeper",
		"passing",
		"passing_types",
		"goal_shot_creation",
		"defense",
		"possession",
		"misc"
	];

	const exclude = new Set([
		"league",
		"season",
		"team",
		"opponent",
		"venue",
		"result",
		"match_report",
		"time",
		"date",
		"game_id",
		"competition",
		"source",
		"week",
		"round",
		"day"
	]);

	const stats: Record<string, Record<string, unknown> | null> = {};
	for (const statType of statTables) {
		const table = `fbref_team_match_${statType}`;
		const tableColumns = await getColumns(table);
		const filters = buildTeamFilters(tableColumns, teamNames, season, competition);
		stats[statType] = await sumTable({
			table,
			whereSql: filters.whereSql,
			params: filters.params,
			exclude,
			extraSelect: ["COUNT(*)::int AS matches"]
		});
	}

	const totalsRow = totalsResult.rows[0];
	const totals = totalsRow ?? {};
	const matchesCount =
		typeof totalsRow?.matches === "number" && Number.isFinite(totalsRow.matches)
			? totalsRow.matches
			: null;
	const minutes = matchesCount ? matchesCount * 90 : null;
	const totalsView = scaleTotals(
		totals,
		mode,
		matchesCount,
		minutes,
		new Set(["matches", "min", "minutes"])
	);

	const statsView =
		mode === "total"
			? stats
			: Object.fromEntries(
					Object.entries(stats).map(([category, totalsRow]) => {
						if (!totalsRow) {
							return [category, null];
						}
						return [
							category,
							scaleTotals(
								totalsRow,
								mode,
								matchesCount,
								minutes,
								new Set(["matches", "min", "minutes"])
							)
						];
					})
				);

	let matchLog: TeamMatch[] = [];
	try {
		if (await tableExists("matches")) {
			const matchColumns = await getColumns("matches");
			const matchDateColumn = pickColumnFromSet(matchColumns, ["match_date", "date"]);
			const matchDateExpr = matchDateColumn
				? `m.${quoteIdent(matchDateColumn)}::text`
				: "NULL::text";
			const matchOrderExpr = matchDateColumn ? `m.${quoteIdent(matchDateColumn)}` : "NULL";
			const matchFilters = buildMatchFilters(matchColumns, teamNames, season, competition);
			const homeGoalsExpr = goalsForColumn
				? `home_stats.${quoteIdent(goalsForColumn)}::int`
				: "NULL::int";
			const awayGoalsExpr = goalsForColumn
				? `away_stats.${quoteIdent(goalsForColumn)}::int`
				: "NULL::int";
			const matchesResult = await db.query<{
				game_id: string;
				match_date: string | null;
				home_team: string | null;
				away_team: string | null;
				home_goals: number | null;
				away_goals: number | null;
			}>(
				`
				SELECT
					m.game_id,
					${matchDateExpr} AS match_date,
					m.home_team,
					m.away_team,
					${homeGoalsExpr} AS home_goals,
					${awayGoalsExpr} AS away_goals
				FROM matches m
				LEFT JOIN team_match_stats home_stats
					ON home_stats.game_id = m.game_id
					AND home_stats.team = m.home_team
				LEFT JOIN team_match_stats away_stats
					ON away_stats.game_id = m.game_id
					AND away_stats.team = m.away_team
				WHERE ${matchFilters.whereSql}
				ORDER BY ${matchOrderExpr} ASC NULLS LAST
				`,
				matchFilters.params
			);

			const matchIds = matchesResult.rows
				.map((row) => row.game_id)
				.filter((value): value is string => Boolean(value));

			const scorerMap = new Map<string, Map<string, MatchScorer[]>>();
			if (matchIds.length > 0 && (await tableExists("player_match_stats"))) {
				const scorerColumns = await getColumns("player_match_stats");
				const scorerFilters = buildScorerFilters(
					scorerColumns,
					matchIds,
					season,
					competition
				);
				const hasGoalData =
					scorerColumns.has("goals") &&
					scorerColumns.has("player") &&
					scorerColumns.has("team") &&
					scorerColumns.has("game_id");
				if (hasGoalData) {
					const scorerRows = await db.query<{
						game_id: string;
						team: string | null;
						player: string | null;
						goals: number;
					}>(
						`
						SELECT
							game_id,
							team,
							player,
							SUM(COALESCE(goals, 0))::int AS goals
						FROM player_match_stats
						WHERE ${scorerFilters.whereSql} AND COALESCE(goals, 0) > 0
						GROUP BY game_id, team, player
						ORDER BY goals DESC, player ASC
						`,
						scorerFilters.params
					);

					for (const row of scorerRows.rows) {
						if (!row.game_id || !row.team || !row.player) {
							continue;
						}
						const matchEntry = scorerMap.get(row.game_id) ?? new Map<string, MatchScorer[]>();
						const teamEntry = matchEntry.get(row.team) ?? [];
						teamEntry.push({ player: row.player, goals: row.goals });
						matchEntry.set(row.team, teamEntry);
						scorerMap.set(row.game_id, matchEntry);
					}
				}
			}

			matchLog = matchesResult.rows.map((row) => {
				const matchEntry = scorerMap.get(row.game_id) ?? new Map<string, MatchScorer[]>();
				const homeTeam = row.home_team ?? "";
				const awayTeam = row.away_team ?? "";
				return {
					game_id: row.game_id,
					match_date: row.match_date,
					home_team: row.home_team,
					away_team: row.away_team,
					home_goals: row.home_goals ?? null,
					away_goals: row.away_goals ?? null,
					home_scorers: matchEntry.get(homeTeam) ?? [],
					away_scorers: matchEntry.get(awayTeam) ?? []
				};
			});
		}
	} catch {
		matchLog = [];
	}

	return json({
		team: teamName,
		mode,
		totals: totalsView,
		stats: statsView,
		matches: matchLog
	});
};
