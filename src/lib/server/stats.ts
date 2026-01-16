import { db } from "$lib/server/db";

export type StatMode = "total" | "per-game" | "per-90";

const numericTypes = new Set([
	"smallint",
	"integer",
	"bigint",
	"numeric",
	"real",
	"double precision"
]);

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

const toNumberIfPossible = (value: unknown) => {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof value === "number") {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isNaN(parsed) ? value : parsed;
	}
	return value;
};

const normalizeRow = (row: Record<string, unknown>) => {
	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(row)) {
		output[key] = toNumberIfPossible(value);
	}
	return output;
};

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

export const parseStatMode = (value: string | null): StatMode => {
	if (value === "per-game" || value === "per-90" || value === "total") {
		return value;
	}
	return "total";
};

export const scaleTotals = (
	totals: Record<string, unknown>,
	mode: StatMode,
	perGameDenom: number | null,
	per90Minutes: number | null,
	exclude: Set<string>
) => {
	if (mode === "total") {
		return totals;
	}

	const perGame = perGameDenom && perGameDenom > 0 ? perGameDenom : null;
	const per90Base =
		per90Minutes && per90Minutes > 0 ? per90Minutes : perGame ? perGame * 90 : null;

	const output: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(totals)) {
		if (exclude.has(key) || !isFiniteNumber(value)) {
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

const tableExists = async (table: string) => {
	const result = await db.query<{ name: string | null }>(
		"SELECT to_regclass($1) AS name",
		[`public.${table}`]
	);
	return Boolean(result.rows[0]?.name);
};

const fetchNumericColumns = async (table: string, exclude: Set<string>) => {
	const result = await db.query<{ column_name: string; data_type: string }>(
		`SELECT column_name, data_type
		 FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = $1`,
		[table]
	);

	return result.rows
		.filter((row) => numericTypes.has(row.data_type) && !exclude.has(row.column_name))
		.map((row) => row.column_name);
};

export const sumTable = async ({
	table,
	whereSql,
	params,
	exclude = new Set<string>(),
	extraSelect = []
}: {
	table: string;
	whereSql: string;
	params: unknown[];
	exclude?: Set<string>;
	extraSelect?: string[];
}) => {
	if (!(await tableExists(table))) {
		return null;
	}

	const numericColumns = await fetchNumericColumns(table, exclude);
	const aggregates = numericColumns.map(
		(column) => `SUM(COALESCE(${quoteIdent(column)}, 0)) AS ${quoteIdent(column)}`
	);

	const selectList = [...extraSelect, ...aggregates];
	if (selectList.length === 0) {
		return {};
	}

	const sql = `SELECT ${selectList.join(", ")} FROM ${quoteIdent(table)} WHERE ${whereSql}`;
	const result = await db.query<Record<string, unknown>>(sql, params);
	return normalizeRow(result.rows[0] ?? {});
};
