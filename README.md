# fbsts

fbsts is a fast, modern football stats site inspired by the clean, data‑first feel of StatMuse and Baseball Savant. The goal is to make soccer analytics easy to explore without feeling like a spreadsheet: quick league snapshots, player leaderboards, and team dashboards that you can actually skim. Still working on the site but feel free to browse the code on github.com/shrinikets/fbsts !

This repo contains the full stack — data pipeline, API, and UI — built so it can power a public site and also serve as a portfolio‑ready project.

---

## What it does

- **League dashboard** with standings, upcoming matches, and leaderboards
- **Player pages** with detailed stat breakdowns
- **Team pages** with season totals and match logs
- **API layer** that feeds the frontend and can be reused elsewhere
- **Authentication** to protect data access and reduce scraping

---

## Tech stack (and why)

- **SvelteKit + TypeScript** — fast, clean UI and server endpoints in one place
- **PostgreSQL (Neon/local)** — reliable data store for stats and events
- **Auth0** — production‑ready auth
- **Vercel/Neon** — easy deployment for both the site and the API

---

## How it runs (high‑level)

1) **Data ingestion** pulls match and player data into Postgres.  
2) **Normalization** organizes raw data into clean tables for fast queries.  
3) **API endpoints** serve the site with cached, structured responses.  
4) **SvelteKit frontend** renders dashboards, leaderboards, and detail pages.

---

## Quick start

1) Install dependencies  
```
npm install
```

2) Add a local `.env.local`  
At minimum, add a database URL. Example:
```
DATABASE_URL=postgresql://user:password@localhost:5432/fbsts
```

3) Start the dev server  
```
npm run dev
```

---

## Project structure

- `scripts/` — data ingestion and normalization scripts  
- `src/routes/api/` — API endpoints for the frontend  
- `src/routes/` — pages (dashboard, player, team, leaderboards)  
- `src/lib/` — shared helpers and UI formatting

---

## Why this project matters

I built fbsts end‑to‑end: data ingestion, database design, API development, and a production‑quality UI. The focus is speed, clarity, and usability. It demonstrates full‑stack skills, data engineering, and product design in a single project.

---

## Roadmap (short)

- Expand league coverage and seasons  
- Add visual “Data Hub” tools (shot maps, xG charts, filters)  
- Improve search and explorer workflows

---

If you’re a recruiter or just curious, feel free to explore the code or reach out. I’m happy to walk through how each layer works.
