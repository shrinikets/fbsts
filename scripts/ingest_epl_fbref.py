import os
import re
from pathlib import Path

import pandas as pd
import soccerdata as sd
from sqlalchemy import create_engine, inspect, text


DEFAULT_SEASONS = [
    "2020-2021",
    "2021-2022",
    "2022-2023",
    "2023-2024",
    "2024-2025",
]
COMPETITION = "ENG-Premier League"
SOURCE = "fbref"
TEAM_MATCH_STAT_TYPES = [
    "schedule",
    "shooting",
    "keeper",
    "passing",
    "passing_types",
    "goal_shot_creation",
    "defense",
    "possession",
    "misc",
]
PLAYER_MATCH_STAT_TYPES = [
    "summary",
    "keepers",
    "passing",
    "passing_types",
    "defense",
    "possession",
    "misc",
]


def _parse_seasons(raw: str | None) -> list[str]:
    if not raw:
        return DEFAULT_SEASONS
    seasons = [item.strip() for item in raw.split(",") if item.strip()]
    return seasons or DEFAULT_SEASONS


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        columns = ["_".join([str(part) for part in col if part not in (None, "", "nan")]) for col in df.columns]
    else:
        columns = [str(col) for col in df.columns]

    normalized = []
    seen = {}
    for col in columns:
        col = re.sub(r"[^A-Za-z0-9]+", "_", col).strip("_").lower()
        if not col:
            col = "col"
        count = seen.get(col, 0)
        if count:
            new_col = f"{col}_{count + 1}"
        else:
            new_col = col
        seen[col] = count + 1
        normalized.append(new_col)

    df = df.copy()
    df.columns = normalized
    return df


def _infer_sql_type(series: pd.Series) -> str:
    if pd.api.types.is_integer_dtype(series):
        return "INTEGER"
    if pd.api.types.is_float_dtype(series):
        return "DOUBLE PRECISION"
    if pd.api.types.is_bool_dtype(series):
        return "BOOLEAN"
    if pd.api.types.is_datetime64_any_dtype(series):
        return "TIMESTAMPTZ"
    return "TEXT"


def _ensure_table_schema(df: pd.DataFrame, table_name: str, engine) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(table_name):
        df.head(0).to_sql(table_name, engine, if_exists="append", index=False)
        return

    existing = {col["name"] for col in inspector.get_columns(table_name)}
    missing = [col for col in df.columns if col not in existing]
    if not missing:
        return

    with engine.begin() as conn:
        for col in missing:
            sql_type = _infer_sql_type(df[col])
            conn.execute(text(f'ALTER TABLE "{table_name}" ADD COLUMN "{col}" {sql_type}'))


def _delete_existing_rows(engine, table_name: str, seasons: list[str]) -> None:
    inspector = inspect(engine)
    if not inspector.has_table(table_name):
        return

    with engine.begin() as conn:
        conn.execute(
            text(
                f"""
                DELETE FROM "{table_name}"
                WHERE season = ANY(:seasons)
                  AND competition = :competition
                """
            ),
            {"seasons": seasons, "competition": COMPETITION},
        )


def _load_to_db(
    df: pd.DataFrame, table_name: str, engine, seasons: list[str], replace: bool
) -> None:
    if replace:
        df.to_sql(table_name, engine, if_exists="replace", index=False)
    else:
        _ensure_table_schema(df, table_name, engine)
        _delete_existing_rows(engine, table_name, seasons)
        df.to_sql(table_name, engine, if_exists="append", index=False)

    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO ingest_runs (table_name, row_count)
                VALUES (:table_name, :row_count)
                """
            ),
            {"table_name": table_name, "row_count": int(len(df))},
        )


def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("Missing DATABASE_URL (e.g., postgresql://user:pass@localhost:5432/fbsts)")

    seasons = _parse_seasons(os.environ.get("FBREF_SEASONS"))
    replace = os.environ.get("FBREF_RESET") == "1"

    engine = create_engine(db_url)

    schema_path = Path(__file__).resolve().parent / "schema.sql"
    with engine.begin() as conn:
        conn.execute(text(schema_path.read_text(encoding="utf-8")))

    total_rows = 0
    print(f"Seasons: {', '.join(seasons)}")
    if replace:
        print("Mode: full replace (FBREF_RESET=1)")
    else:
        print("Mode: incremental (append by season)")

    for stat_type in TEAM_MATCH_STAT_TYPES:
        print(f"Starting team match stats: {stat_type}...")
        frames = []
        for season in seasons:
            print(f"  Season {season}...")
            fbref = sd.FBref(leagues=COMPETITION, seasons=season)
            match_stats = fbref.read_team_match_stats(stat_type=stat_type).reset_index()
            match_stats = _normalize_columns(match_stats)
            match_stats["season"] = season
            match_stats["competition"] = COMPETITION
            match_stats["source"] = SOURCE
            frames.append(match_stats)
        match_stats = pd.concat(frames, ignore_index=True, sort=False) if frames else pd.DataFrame()
        table_name = f"fbref_team_match_{stat_type}"
        _load_to_db(match_stats, table_name, engine, seasons, replace)
        print(f"Finished team match stats: {stat_type} ({len(match_stats)} rows).")
        total_rows += len(match_stats)

    for stat_type in PLAYER_MATCH_STAT_TYPES:
        print(f"Starting player match stats: {stat_type}...")
        frames = []
        for season in seasons:
            print(f"  Season {season}...")
            fbref = sd.FBref(leagues=COMPETITION, seasons=season)
            player_stats = fbref.read_player_match_stats(stat_type=stat_type).reset_index()
            player_stats = _normalize_columns(player_stats)
            player_stats["season"] = season
            player_stats["competition"] = COMPETITION
            player_stats["source"] = SOURCE
            frames.append(player_stats)
        player_stats = pd.concat(frames, ignore_index=True, sort=False) if frames else pd.DataFrame()
        table_name = f"fbref_player_match_{stat_type}"
        _load_to_db(player_stats, table_name, engine, seasons, replace)
        print(f"Finished player match stats: {stat_type} ({len(player_stats)} rows).")
        total_rows += len(player_stats)

    print(f"Loaded {total_rows} rows across {len(TEAM_MATCH_STAT_TYPES) + len(PLAYER_MATCH_STAT_TYPES)} tables.")


if __name__ == "__main__":
    main()
