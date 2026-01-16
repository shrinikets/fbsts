import { error, json } from "@sveltejs/kit";

import { db } from "$lib/server/db";
import { slugSql } from "$lib/server/slug";
import { parseStatMode, scaleTotals, sumTable } from "$lib/server/stats";
import { teamNameOptions } from "$lib/server/team-names";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, url }) => {
	const slug = params.slug.trim().toLowerCase();
	const mode = parseStatMode(url.searchParams.get("mode"));

	const teamResult = await db.query<{ name: string }>(
		`SELECT name
		 FROM teams
		 WHERE ${slugSql("name")} = $1
		 LIMIT 1`,
		[slug]
	);

	if (teamResult.rowCount === 0) {
		throw error(404, "Team not found");
	}

	const teamName = teamResult.rows[0].name;
	const teamNames = teamNameOptions(teamName);

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
			SUM(CASE WHEN result = 'W' THEN 1 ELSE 0 END)::int AS wins,
			SUM(CASE WHEN result = 'D' THEN 1 ELSE 0 END)::int AS draws,
			SUM(CASE WHEN result = 'L' THEN 1 ELSE 0 END)::int AS losses,
			SUM(COALESCE(goals_for, 0))::int AS goals_for,
			SUM(COALESCE(goals_against, 0))::int AS goals_against,
			SUM(COALESCE(goals_for, 0) - COALESCE(goals_against, 0))::int AS goal_diff,
			SUM(CASE WHEN result = 'W' THEN 3 WHEN result = 'D' THEN 1 ELSE 0 END)::int AS points
		 FROM team_match_stats
		 WHERE team = ANY($1)`,
		[teamNames]
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
		stats[statType] = await sumTable({
			table,
			whereSql: "team = ANY($1)",
			params: [teamNames],
			exclude,
			extraSelect: ["COUNT(*)::int AS matches"]
		});
	}

	const totalsRow = totalsResult.rows[0];
	const totals = totalsRow ?? {};
	const matches =
		typeof totalsRow?.matches === "number" && Number.isFinite(totalsRow.matches)
			? totalsRow.matches
			: null;
	const minutes = matches ? matches * 90 : null;
	const totalsView = scaleTotals(
		totals,
		mode,
		matches,
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
								matches,
								minutes,
								new Set(["matches", "min", "minutes"])
							)
						];
					})
				);

	return json({
		team: teamName,
		mode,
		totals: totalsView,
		stats: statsView
	});
};
