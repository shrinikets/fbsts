import { error, json } from "@sveltejs/kit";

import { db } from "$lib/server/db";
import { slugSql } from "$lib/server/slug";
import { parseStatMode, scaleTotals, sumTable } from "$lib/server/stats";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ params, url }) => {
	const slug = params.slug.trim().toLowerCase();
	const mode = parseStatMode(url.searchParams.get("mode"));

	const playerResult = await db.query<{ name: string }>(
		`SELECT name
		 FROM players
		 WHERE ${slugSql("name")} = $1
		 LIMIT 1`,
		[slug]
	);

	if (playerResult.rowCount === 0) {
		throw error(404, "Player not found");
	}

	const playerName = playerResult.rows[0].name;

	const totals = (await sumTable({
		table: "fbref_player_match_summary",
		whereSql: "player = $1",
		params: [playerName],
		exclude: new Set([
			"league",
			"season",
			"game",
			"team",
			"player",
			"nation",
			"pos",
			"age",
			"jersey_number",
			"competition",
			"source",
			"game_id"
		]),
		extraSelect: ["COUNT(*)::int AS appearances"]
	})) ?? {};

	const appearances =
		typeof totals.appearances === "number" && Number.isFinite(totals.appearances)
			? totals.appearances
			: null;
	const minutes =
		typeof totals.min === "number" && Number.isFinite(totals.min)
			? totals.min
			: typeof totals.minutes === "number" && Number.isFinite(totals.minutes)
				? totals.minutes
				: null;

	const totalsView = scaleTotals(
		totals,
		mode,
		appearances,
		minutes,
		new Set(["appearances", "min", "minutes"])
	);

	const teamsResult = await db.query<{
		team: string;
		appearances: number;
		goals: number;
		assists: number;
		minutes: number;
	}>(
		`SELECT
			team,
			COUNT(*)::int AS appearances,
			SUM(COALESCE(goals, 0))::int AS goals,
			SUM(COALESCE(assists, 0))::int AS assists,
			SUM(COALESCE(minutes, 0))::int AS minutes
		 FROM player_match_stats
		 WHERE player = $1
		 GROUP BY team
		 ORDER BY goals DESC, appearances DESC`,
		[playerName]
	);

	const byTeam =
		mode === "total"
			? teamsResult.rows
			: teamsResult.rows.map((row) =>
					scaleTotals(
						row as Record<string, unknown>,
						mode,
						row.appearances ?? null,
						row.minutes ?? null,
						new Set(["team", "appearances", "minutes"])
					)
				);

	return json({
		player: playerName,
		mode,
		totals: totalsView,
		byTeam
	});
};
