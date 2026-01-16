import os
import re
from pathlib import Path

import pandas as pd
import soccerdata as sd
from sqlalchemy import create_engine, text


SEASON = "2024-2025"
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


def _load_to_db(df: pd.DataFrame, table_name: str, engine) -> None:
    df.to_sql(table_name, engine, if_exists="replace", index=False)

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

    engine = create_engine(db_url)

    schema_path = Path(__file__).resolve().parent / "schema.sql"
    with engine.begin() as conn:
        conn.execute(text(schema_path.read_text(encoding="utf-8")))

    fbref = sd.FBref(leagues=COMPETITION, seasons=SEASON)

    total_rows = 0

    for stat_type in TEAM_MATCH_STAT_TYPES:
        print(f"Starting team match stats: {stat_type}...")
        match_stats = fbref.read_team_match_stats(stat_type=stat_type).reset_index()
        match_stats = _normalize_columns(match_stats)
        match_stats["season"] = SEASON
        match_stats["competition"] = COMPETITION
        match_stats["source"] = SOURCE
        table_name = f"fbref_team_match_{stat_type}"
        _load_to_db(match_stats, table_name, engine)
        print(f"Finished team match stats: {stat_type} ({len(match_stats)} rows).")
        total_rows += len(match_stats)

    for stat_type in PLAYER_MATCH_STAT_TYPES:
        print(f"Starting player match stats: {stat_type}...")
        player_stats = fbref.read_player_match_stats(stat_type=stat_type).reset_index()
        player_stats = _normalize_columns(player_stats)
        player_stats["season"] = SEASON
        player_stats["competition"] = COMPETITION
        player_stats["source"] = SOURCE
        table_name = f"fbref_player_match_{stat_type}"
        _load_to_db(player_stats, table_name, engine)
        print(f"Finished player match stats: {stat_type} ({len(player_stats)} rows).")
        total_rows += len(player_stats)

    print(f"Loaded {total_rows} rows across {len(TEAM_MATCH_STAT_TYPES) + len(PLAYER_MATCH_STAT_TYPES)} tables.")


if __name__ == "__main__":
    main()
