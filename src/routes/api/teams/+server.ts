import { json } from "@sveltejs/kit";

import { db } from "$lib/server/db";
import { slugSql } from "$lib/server/slug";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get("q")?.trim().toLowerCase();
	const limit = Number(url.searchParams.get("limit") ?? "25");
	const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 25;

	if (q) {
		const result = await db.query<{ name: string }>(
			`SELECT name
			 FROM teams
			 WHERE ${slugSql("name")} LIKE $1
			 ORDER BY name
			 LIMIT $2`,
			[`%${q}%`, safeLimit]
		);
		return json({ teams: result.rows.map((row) => row.name) });
	}

	const result = await db.query<{ name: string }>(
		`SELECT name
		 FROM teams
		 ORDER BY name
		 LIMIT $1`,
		[safeLimit]
	);

	return json({ teams: result.rows.map((row) => row.name) });
};
