import { env } from "$env/dynamic/private";
import { Pool } from "pg";

const connectionString = env.DATABASE_URL;
if (!connectionString) {
	throw new Error("DATABASE_URL is not set.");
}

const globalForPg = globalThis as typeof globalThis & { pgPool?: Pool };

const pool =
	globalForPg.pgPool ??
	new Pool({
		connectionString,
		max: 5,
		idleTimeoutMillis: 30_000
	});

if (process.env.NODE_ENV !== "production") {
	globalForPg.pgPool = pool;
}

pool.on("error", (error) => {
	console.error("Postgres pool error:", error);
});

export const db = {
	query: <T = unknown>(text: string, params: unknown[] = []) => pool.query<T>(text, params)
};
