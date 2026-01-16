import { error, json } from "@sveltejs/kit";

import { db } from "$lib/server/db";
import { slugSql } from "$lib/server/slug";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get("q")?.trim().toLowerCase();
	if (!q) {
		throw error(400, "Missing required query param: q");
	}

	const limit = Number(url.searchParams.get("limit") ?? "25");
	const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25;

	const result = await db.query<{ name: string }>(
		`SELECT name
		 FROM players
		 WHERE ${slugSql("name")} LIKE $1
		 ORDER BY name
		 LIMIT $2`,
		[`%${q}%`, safeLimit]
	);

	return json({ players: result.rows.map((row) => row.name) });
};
