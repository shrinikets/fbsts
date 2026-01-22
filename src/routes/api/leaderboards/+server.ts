import { error, json } from "@sveltejs/kit";

import { db } from "$lib/server/db";

import type { RequestHandler } from "./$types";

type StatMode = "total" | "per-game" | "per-90";

type DenominatorConfig = {
	table: string;
	columns: Set<string>;
	minutesColumn: string | null;
};

const DEFAULT_SEASON = "2024-2025";
const DEFAULT_COMPETITION = "ENG-Premier League";
const DEFAULT_LIMIT = 5;
const SUMMARY_TABLE = "fbref_player_match_summary";

const ALLOWED_TABLES = [
	{ table: "fbref_player_match_summary", label: "Summary" },
	{ table: "fbref_player_match_passing", label: "Passing" },
	{ table: "fbref_player_match_passing_types", label: "Passing Types" },
	{ table: "fbref_player_match_defense", label: "Defense" },
	{ table: "fbref_player_match_possession", label: "Possession" },
	{ table: "fbref_player_match_misc", label: "Misc" },
	{ table: "fbref_player_match_keepers", label: "Keepers" }
];

const numericTypes = new Set([
	"smallint",
	"integer",
	"bigint",
	"numeric",
	"real",
	"double precision"
]);

const EXCLUDE_COLUMNS = new Set([
	"id",
	"season",
	"competition",
	"player",
	"team",
	"opponent",
	"league",
	"game_id",
	"game",
	"match_report",
	"venue",
	"date",
	"day",
	"time",
	"round",
	"week",
	"age",
	"nation",
	"pos",
	"fbref_match_id",
	"source",
	"jersey_number"
]);

const percentageExceptions = new Set(["performance_2crdy"]);

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

const parseMode = (value: string | null): StatMode => {
	if (value === "per-game" || value === "per-90" || value === "total") {
		return value;
	}
	return "total";
};

const isPercentageColumn = (column: string) => {
	const normalized = column.toLowerCase();
	if (percentageExceptions.has(normalized)) {
		return false;
	}
	if (normalized === "poss" || normalized === "performance_save") {
		return true;
	}
	if (
		normalized.includes("pct") ||
		normalized.includes("percent") ||
		normalized.includes("perc")
	) {
		return true;
	}
	return normalized.endsWith("_2");
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

const getNumericColumns = async (table: string) => {
	const result = await db.query<{ column_name: string; data_type: string }>(
		`SELECT column_name, data_type
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1`,
		[table]
	);
	return result.rows
		.filter((row) => numericTypes.has(row.data_type) && !EXCLUDE_COLUMNS.has(row.column_name))
		.map((row) => row.column_name);
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
		params,
		nextIndex: index
	};
};

const buildDenominatorConfig = async (fallbackTable: string): Promise<DenominatorConfig> => {
	const summaryColumns = await getColumns(SUMMARY_TABLE);
	if (summaryColumns.has("player")) {
		return {
			table: SUMMARY_TABLE,
			columns: summaryColumns,
			minutesColumn: summaryColumns.has("min")
				? "min"
				: summaryColumns.has("minutes")
					? "minutes"
					: null
		};
	}

	const fallbackColumns = await getColumns(fallbackTable);
	return {
		table: fallbackTable,
		columns: fallbackColumns,
		minutesColumn: fallbackColumns.has("min")
			? "min"
			: fallbackColumns.has("minutes")
				? "minutes"
				: null
	};
};

const fetchLeaderboardRows = async ({
	table,
	column,
	season,
	competition,
	limit,
	mode,
	denominator
}: {
	table: string;
	column: string;
	season: string;
	competition: string;
	limit?: number | null;
	mode: StatMode;
	denominator: DenominatorConfig;
}) => {
	const tableColumns = await getColumns(table);
	if (!tableColumns.has("player")) {
		throw error(400, `Missing player column in ${table}.`);
	}

	const isPercent = isPercentageColumn(column);
	let effectiveMode: StatMode = isPercent ? "per-game" : mode;
	if (effectiveMode === "per-90" && !denominator.minutesColumn) {
		effectiveMode = "per-game";
	}

	const columnExpr = `s.${quoteIdent(column)}`;

	const buildQuery = (includeCompetition: boolean) => {
		if (isPercent || effectiveMode === "total") {
			const mainFilters = buildFiltersWithOffset(
				tableColumns,
				season,
				competition,
				includeCompetition,
				1
			);
			const limitClause = limit ? `LIMIT $${mainFilters.nextIndex}` : "";
			const params = limit ? [...mainFilters.params, limit] : mainFilters.params;
			const valueExpr = isPercent
				? `AVG(COALESCE(${columnExpr}, 0))::double precision`
				: `SUM(COALESCE(${columnExpr}, 0))::double precision`;
			const sql = `
				SELECT s.player, ${valueExpr} AS value
				FROM ${quoteIdent(table)} s
				WHERE ${mainFilters.where} AND s.player IS NOT NULL
				GROUP BY s.player
				ORDER BY value DESC NULLS LAST, s.player ASC
				${limitClause}
			`;
			return { sql, params };
		}

		const denomFilters = buildFiltersWithOffset(
			denominator.columns,
			season,
			competition,
			includeCompetition,
			1
		);
		const mainFilters = buildFiltersWithOffset(
			tableColumns,
			season,
			competition,
			includeCompetition,
			denomFilters.nextIndex
		);
		const params = [...denomFilters.params, ...mainFilters.params];
		const limitClause = limit ? `LIMIT $${mainFilters.nextIndex}` : "";
		if (limit) {
			params.push(limit);
		}

		const minutesExpr = denominator.minutesColumn
			? `SUM(COALESCE(${quoteIdent(denominator.minutesColumn)}, 0))::double precision AS minutes`
			: "NULL::double precision AS minutes";
		const denomSql = `
			denom AS (
				SELECT player, COUNT(*)::int AS appearances, ${minutesExpr}
				FROM ${quoteIdent(denominator.table)}
				WHERE ${denomFilters.where}
				GROUP BY player
			)
		`;
		const valueExpr =
			effectiveMode === "per-90" && denominator.minutesColumn
				? `(SUM(COALESCE(${columnExpr}, 0)) / NULLIF(denom.minutes, 0) * 90)::double precision`
				: `(SUM(COALESCE(${columnExpr}, 0)) / NULLIF(denom.appearances, 0))::double precision`;
		const sql = `
			WITH ${denomSql}
			SELECT s.player, ${valueExpr} AS value
			FROM ${quoteIdent(table)} s
			LEFT JOIN denom ON denom.player = s.player
			WHERE ${mainFilters.where} AND s.player IS NOT NULL
			GROUP BY s.player, denom.appearances, denom.minutes
			ORDER BY value DESC NULLS LAST, s.player ASC
			${limitClause}
		`;
		return { sql, params };
	};

	const primary = buildQuery(true);
	const result = await db.query<{ player: string; value: number }>(primary.sql, primary.params);
	const hasSeason = tableColumns.has("season");
	const hasCompetition = tableColumns.has("competition");
	if (result.rowCount > 0 || !hasSeason || !hasCompetition) {
		return result.rows;
	}

	const fallback = buildQuery(false);
	const fallbackResult = await db.query<{ player: string; value: number }>(
		fallback.sql,
		fallback.params
	);
	return fallbackResult.rows;
};

const cacheHeaders = {
	"Cache-Control": "private, max-age=120, stale-while-revalidate=300",
	Vary: "Authorization"
};

export const GET: RequestHandler = async ({ url }) => {
	const season = url.searchParams.get("season") ?? DEFAULT_SEASON;
	const competition = url.searchParams.get("competition") ?? DEFAULT_COMPETITION;
	const tableParam = url.searchParams.get("table");
	const columnParam = url.searchParams.get("column");
	const catalog = url.searchParams.get("catalog") === "1";
	const limitParam = Number(url.searchParams.get("limit"));
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT;
	const mode = parseMode(url.searchParams.get("mode"));

	if (catalog || (!tableParam && !columnParam)) {
		const tables = await Promise.all(
			ALLOWED_TABLES.map(async (table) => ({
				...table,
				columns: await getNumericColumns(table.table)
			}))
		);
		return json({ tables }, { headers: cacheHeaders });
	}

	if (!tableParam) {
		throw error(400, "Missing table parameter.");
	}

	const tableMeta = ALLOWED_TABLES.find((item) => item.table === tableParam);
	if (!tableMeta) {
		throw error(400, "Unsupported table.");
	}

	const numericColumns = await getNumericColumns(tableMeta.table);
	if (numericColumns.length === 0) {
		return json({ table: tableMeta.table, columns: [], leaderboards: {} }, { headers: cacheHeaders });
	}

	const denominator = await buildDenominatorConfig(tableMeta.table);

	if (columnParam) {
		if (!numericColumns.includes(columnParam)) {
			throw error(400, "Unsupported column.");
		}
		const rows = await fetchLeaderboardRows({
			table: tableMeta.table,
			column: columnParam,
			season,
			competition,
			limit: null,
			mode,
			denominator
		});
		return json(
			{ table: tableMeta.table, column: columnParam, rows },
			{ headers: cacheHeaders }
		);
	}

	const leaderboards: Record<string, { player: string; value: number }[]> = {};
	for (const column of numericColumns) {
		leaderboards[column] = await fetchLeaderboardRows({
			table: tableMeta.table,
			column,
			season,
			competition,
			limit,
			mode,
			denominator
		});
	}

	return json(
		{ table: tableMeta.table, columns: numericColumns, leaderboards, mode },
		{ headers: cacheHeaders }
	);
};
