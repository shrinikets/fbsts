import { json } from "@sveltejs/kit";

import { db } from "$lib/server/db";

import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async () => {
	const result = await db.query<{ name: string }>(
		`SELECT name
		 FROM teams
		 ORDER BY name`
	);

	return json({ teams: result.rows.map((row) => row.name) });
};
