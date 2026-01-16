# Data ingest

This folder contains a small ETL script that pulls Premier League 2024-2025 data
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

## Run

```powershell
python scripts\ingest_epl_fbref.py
```

## Normalize (optional but recommended)

This creates a small, query-friendly schema you can use for API endpoints.

```powershell
python scripts\normalize_epl_fbref.py
```
