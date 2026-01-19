CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
    game_id TEXT PRIMARY KEY,
    fbref_match_id TEXT,
    competition TEXT,
    season TEXT,
    match_date DATE,
    home_team TEXT,
    away_team TEXT
);

CREATE TABLE IF NOT EXISTS team_match_stats (
    id SERIAL PRIMARY KEY,
    game_id TEXT REFERENCES matches(game_id),
    team TEXT NOT NULL,
    opponent TEXT,
    venue TEXT,
    result TEXT,
    goals_for INTEGER,
    goals_against INTEGER,
    competition TEXT,
    season TEXT
);

CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS player_match_stats (
    id SERIAL PRIMARY KEY,
    game_id TEXT REFERENCES matches(game_id),
    player TEXT NOT NULL,
    team TEXT,
    opponent TEXT,
    minutes INTEGER,
    goals INTEGER,
    assists INTEGER,
    shots INTEGER,
    competition TEXT,
    season TEXT
);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS fbref_match_id TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS competition TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS season TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_date DATE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS home_team TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS away_team TEXT;

ALTER TABLE team_match_stats ADD COLUMN IF NOT EXISTS competition TEXT;
ALTER TABLE team_match_stats ADD COLUMN IF NOT EXISTS season TEXT;

ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS competition TEXT;
ALTER TABLE player_match_stats ADD COLUMN IF NOT EXISTS season TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_name_unique ON teams (name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name_unique ON players (name);

CREATE INDEX IF NOT EXISTS idx_matches_season ON matches(season);
CREATE INDEX IF NOT EXISTS idx_matches_competition ON matches(competition);

CREATE INDEX IF NOT EXISTS idx_team_match_stats_game ON team_match_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_team_match_stats_team ON team_match_stats(team);
CREATE INDEX IF NOT EXISTS idx_team_match_stats_team_season ON team_match_stats(team, season);
CREATE INDEX IF NOT EXISTS idx_team_match_stats_season_competition ON team_match_stats(season, competition);

CREATE INDEX IF NOT EXISTS idx_player_match_stats_game ON player_match_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_player ON player_match_stats(player);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_team ON player_match_stats(team);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_player_season ON player_match_stats(player, season);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_season_competition ON player_match_stats(season, competition);
