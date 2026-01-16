DROP TABLE IF EXISTS player_match_stats;
DROP TABLE IF EXISTS players;
DROP TABLE IF EXISTS team_match_stats;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS teams;

CREATE TABLE teams (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE matches (
    game_id TEXT PRIMARY KEY,
    fbref_match_id TEXT,
    competition TEXT,
    season TEXT,
    match_date DATE,
    home_team TEXT,
    away_team TEXT
);

CREATE TABLE team_match_stats (
    id SERIAL PRIMARY KEY,
    game_id TEXT REFERENCES matches(game_id),
    team TEXT NOT NULL,
    opponent TEXT,
    venue TEXT,
    result TEXT,
    goals_for INTEGER,
    goals_against INTEGER
);

CREATE TABLE players (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE player_match_stats (
    id SERIAL PRIMARY KEY,
    game_id TEXT REFERENCES matches(game_id),
    player TEXT NOT NULL,
    team TEXT,
    opponent TEXT,
    minutes INTEGER,
    goals INTEGER,
    assists INTEGER,
    shots INTEGER
);

CREATE INDEX IF NOT EXISTS idx_team_match_stats_game ON team_match_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_team_match_stats_team ON team_match_stats(team);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_game ON player_match_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_player ON player_match_stats(player);
CREATE INDEX IF NOT EXISTS idx_player_match_stats_team ON player_match_stats(team);
