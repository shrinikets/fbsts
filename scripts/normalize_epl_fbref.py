import os
from pathlib import Path

import pandas as pd
from sqlalchemy import create_engine, text


RAW_TEAM_SCHEDULE = "fbref_team_match_schedule"
RAW_PLAYER_SUMMARY = "fbref_player_match_summary"
TEAM_NAME_FIXUPS = {
    "Newcastle Utd": "Newcastle United",
    "Nott'ham Forest": "Nottingham Forest",
    "Tottenham": "Tottenham Hotspur",
    "West Ham": "West Ham United",
    "Manchester Utd": "Manchester United",
}


def _first_existing_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for name in candidates:
        if name in df.columns:
            return name
    return None


def _coerce_int(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").astype("Int64")


def _apply_team_name_fixes(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    df = df.copy()
    for column in columns:
        if column in df.columns:
            df[column] = df[column].replace(TEAM_NAME_FIXUPS)
    return df


def _prepare_schedule(schedule: pd.DataFrame) -> pd.DataFrame:
    if "game" not in schedule.columns and "game_id" not in schedule.columns:
        raise SystemExit("Schedule table missing game/game_id column.")

    schedule = schedule.copy()
    if "game" in schedule.columns:
        if "game_id" in schedule.columns:
            schedule = schedule.drop(columns=["game_id"])
        schedule = schedule.rename(columns={"game": "game_id"})
    schedule = schedule.loc[:, ~schedule.columns.duplicated()]
    schedule = _apply_team_name_fixes(schedule, ["team", "opponent"])
    return schedule


def _prepare_player_summary(player_summary: pd.DataFrame) -> pd.DataFrame:
    if "game" not in player_summary.columns and "game_id" not in player_summary.columns:
        raise SystemExit("Player summary missing game/game_id column.")

    player_summary = player_summary.copy()
    if "game" in player_summary.columns:
        if "game_id" in player_summary.columns:
            player_summary = player_summary.drop(columns=["game_id"])
        player_summary = player_summary.rename(columns={"game": "game_id"})
    player_summary = player_summary.loc[:, ~player_summary.columns.duplicated()]
    player_summary = _apply_team_name_fixes(player_summary, ["team"])
    return player_summary


def _build_matches(schedule: pd.DataFrame, fbref_map: pd.DataFrame | None) -> pd.DataFrame:
    required = {"game_id", "team", "opponent", "venue", "date", "league", "season"}
    missing = [col for col in required if col not in schedule.columns]
    if missing:
        raise SystemExit(f"Schedule table missing columns: {missing}")

    schedule = schedule.copy()
    schedule["date"] = pd.to_datetime(schedule["date"], errors="coerce")

    match_rows = []
    for game_id, group in schedule.groupby("game_id"):
        row = group.iloc[0]
        venue = group["venue"].fillna("").astype(str).str.lower()
        home_row = group[venue == "home"]
        away_row = group[venue == "away"]

        if not home_row.empty:
            home_team = home_row.iloc[0]["team"]
            away_team = home_row.iloc[0]["opponent"]
        elif not away_row.empty:
            home_team = away_row.iloc[0]["opponent"]
            away_team = away_row.iloc[0]["team"]
        else:
            home_team = row["team"]
            away_team = row["opponent"]

        match_rows.append(
            {
                "game_id": game_id,
                "competition": row.get("league"),
                "season": row.get("season"),
                "match_date": row.get("date"),
                "home_team": home_team,
                "away_team": away_team,
            }
        )

    matches = pd.DataFrame(match_rows)
    if fbref_map is not None and not fbref_map.empty:
        matches = matches.merge(fbref_map, on="game_id", how="left")
    return matches


def _build_teams(schedule: pd.DataFrame) -> pd.DataFrame:
    teams = pd.concat([schedule["team"], schedule["opponent"]]).dropna().unique()
    return pd.DataFrame({"name": sorted(teams)})


def _build_team_match_stats(schedule: pd.DataFrame) -> pd.DataFrame:
    gf_col = _first_existing_column(schedule, ["gf", "goals_for", "goals"])
    ga_col = _first_existing_column(schedule, ["ga", "goals_against", "goals_allowed"])

    stats = schedule.copy()
    required = {"game_id", "team", "opponent", "venue"}
    missing = [col for col in required if col not in stats.columns]
    if missing:
        raise SystemExit(f"Team schedule missing columns: {missing}")
    if "result" not in stats.columns:
        stats["result"] = pd.NA
    if gf_col:
        stats["goals_for"] = _coerce_int(stats[gf_col])
    else:
        stats["goals_for"] = pd.Series([pd.NA] * len(stats), dtype="Int64")
    if ga_col:
        stats["goals_against"] = _coerce_int(stats[ga_col])
    else:
        stats["goals_against"] = pd.Series([pd.NA] * len(stats), dtype="Int64")

    keep = ["game_id", "team", "opponent", "venue", "result", "goals_for", "goals_against"]
    return stats[keep]


def _build_players(player_summary: pd.DataFrame) -> pd.DataFrame:
    if "player" not in player_summary.columns:
        raise SystemExit("Player summary missing player column.")
    players = player_summary["player"].dropna().unique()
    return pd.DataFrame({"name": sorted(players)})


def _build_player_match_stats(
    player_summary: pd.DataFrame, opponent_df: pd.DataFrame
) -> pd.DataFrame:
    minutes_col = _first_existing_column(player_summary, ["min", "minutes"])
    goals_col = _first_existing_column(player_summary, ["gls", "goals", "performance_gls"])
    assists_col = _first_existing_column(player_summary, ["ast", "assists", "performance_ast"])
    shots_col = _first_existing_column(player_summary, ["sh", "shots", "performance_sh"])

    stats = player_summary.copy()
    required = {"game_id", "player", "team"}
    missing = [col for col in required if col not in stats.columns]
    if missing:
        raise SystemExit(f"Player summary missing columns: {missing}")

    stats = stats.merge(opponent_df, on=["game_id", "team"], how="left")

    stats["minutes"] = _coerce_int(stats[minutes_col]) if minutes_col else pd.Series(
        [pd.NA] * len(stats), dtype="Int64"
    )
    stats["goals"] = _coerce_int(stats[goals_col]) if goals_col else pd.Series(
        [pd.NA] * len(stats), dtype="Int64"
    )
    stats["assists"] = _coerce_int(stats[assists_col]) if assists_col else pd.Series(
        [pd.NA] * len(stats), dtype="Int64"
    )
    stats["shots"] = _coerce_int(stats[shots_col]) if shots_col else pd.Series(
        [pd.NA] * len(stats), dtype="Int64"
    )

    keep = ["game_id", "player", "team", "opponent", "minutes", "goals", "assists", "shots"]
    return stats[keep]


def main() -> None:
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise SystemExit("Missing DATABASE_URL (e.g., postgresql://user:pass@localhost:5432/fbsts)")

    engine = create_engine(db_url)

    schema_path = Path(__file__).resolve().parent / "normalize_schema.sql"
    with engine.begin() as conn:
        conn.execute(text(schema_path.read_text(encoding="utf-8")))

    schedule = pd.read_sql(f"SELECT * FROM {RAW_TEAM_SCHEDULE}", engine)
    player_summary = pd.read_sql(f"SELECT * FROM {RAW_PLAYER_SUMMARY}", engine)

    if "game" in schedule.columns and "game" not in player_summary.columns:
        raise SystemExit(
            "Player summary missing 'game' column; cannot align with schedule. "
            "Re-run ingest and ensure fbref_player_match_summary includes game."
        )

    fbref_map = None
    if "game" in player_summary.columns and "game_id" in player_summary.columns:
        fbref_map = (
            player_summary[["game", "game_id"]]
            .dropna()
            .drop_duplicates()
            .groupby("game", as_index=False)["game_id"]
            .first()
            .rename(columns={"game": "game_id", "game_id": "fbref_match_id"})
        )

    schedule_prepped = _prepare_schedule(schedule)
    player_prepped = _prepare_player_summary(player_summary)

    matches = _build_matches(schedule_prepped, fbref_map)
    teams = _build_teams(schedule_prepped)
    team_match_stats = _build_team_match_stats(schedule_prepped)

    players = _build_players(player_prepped)
    opponent_df = schedule_prepped[["game_id", "team", "opponent"]].dropna(
        subset=["game_id", "team"]
    )
    opponent_df = opponent_df.drop_duplicates(subset=["game_id", "team"])
    player_match_stats = _build_player_match_stats(player_prepped, opponent_df)

    teams.to_sql("teams", engine, if_exists="append", index=False)
    matches.to_sql("matches", engine, if_exists="append", index=False)
    team_match_stats.to_sql("team_match_stats", engine, if_exists="append", index=False)
    players.to_sql("players", engine, if_exists="append", index=False)
    player_match_stats.to_sql("player_match_stats", engine, if_exists="append", index=False)

    print(
        "Normalized tables created: teams, matches, team_match_stats, players, player_match_stats."
    )


if __name__ == "__main__":
    main()
