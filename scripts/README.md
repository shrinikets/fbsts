# Data ingest

This folder contains a small ETL script that pulls Premier League data
from FBref via `soccerdata` and loads it into Postgres.

## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install soccerdata pandas pyarrow sqlalchemy psycopg2-binary
```

Set your database URL:

```powershell
$env:DATABASE_URL="postgresql://user:pass@localhost:5432/fbsts"
```

Optional overrides:

```powershell
# Comma-separated list of seasons to (re)load.
$env:FBREF_SEASONS="2020-2021,2021-2022,2022-2023,2023-2024,2024-2025"

# Competition to normalize (defaults to ENG-Premier League).
$env:FBREF_COMPETITION="ENG-Premier League"

# Full reset (drops normalized tables, replaces raw tables).
$env:FBREF_RESET="1"
```

## Run (ingest)

```powershell
python scripts\ingest_epl_fbref.py
```

If you're using the advanced stats tables for API queries, keep team names
consistent by running:

```powershell
psql $env:DATABASE_URL -f scripts\fix_team_names.sql
```

## Normalize (optional but recommended)

This creates a small, query-friendly schema you can use for API endpoints.

```powershell
python scripts\normalize_epl_fbref.py
```
