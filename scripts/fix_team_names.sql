BEGIN;

DO $$
DECLARE
	team_tables text[] := ARRAY[
		'fbref_team_match_schedule',
		'fbref_team_match_shooting',
		'fbref_team_match_keeper',
		'fbref_team_match_passing',
		'fbref_team_match_passing_types',
		'fbref_team_match_goal_shot_creation',
		'fbref_team_match_defense',
		'fbref_team_match_possession',
		'fbref_team_match_misc'
	];
	player_tables text[] := ARRAY[
		'fbref_player_match_summary',
		'fbref_player_match_keepers',
		'fbref_player_match_passing',
		'fbref_player_match_passing_types',
		'fbref_player_match_defense',
		'fbref_player_match_possession',
		'fbref_player_match_misc'
	];
	tbl text;
BEGIN
	FOREACH tbl IN ARRAY team_tables LOOP
		IF EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = tbl
		) THEN
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'team'
			) THEN
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Newcastle United', 'Newcastle Utd');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Nottingham Forest', 'Nott''ham Forest');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Tottenham Hotspur', 'Tottenham');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'West Ham United', 'West Ham');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Manchester United', 'Manchester Utd');
			END IF;
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'opponent'
			) THEN
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Newcastle United', 'Newcastle Utd');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Nottingham Forest', 'Nott''ham Forest');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Tottenham Hotspur', 'Tottenham');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'West Ham United', 'West Ham');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Manchester United', 'Manchester Utd');
			END IF;
		END IF;
	END LOOP;

	FOREACH tbl IN ARRAY player_tables LOOP
		IF EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = tbl
		) THEN
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'team'
			) THEN
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Newcastle United', 'Newcastle Utd');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Nottingham Forest', 'Nott''ham Forest');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Tottenham Hotspur', 'Tottenham');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'West Ham United', 'West Ham');
				EXECUTE format('UPDATE %I SET team = %L WHERE team = %L', tbl, 'Manchester United', 'Manchester Utd');
			END IF;
			IF EXISTS (
				SELECT 1
				FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'opponent'
			) THEN
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Newcastle United', 'Newcastle Utd');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Nottingham Forest', 'Nott''ham Forest');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Tottenham Hotspur', 'Tottenham');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'West Ham United', 'West Ham');
				EXECUTE format('UPDATE %I SET opponent = %L WHERE opponent = %L', tbl, 'Manchester United', 'Manchester Utd');
			END IF;
		END IF;
	END LOOP;
END $$;

UPDATE matches SET home_team = 'Newcastle United' WHERE home_team = 'Newcastle Utd';
UPDATE matches SET away_team = 'Newcastle United' WHERE away_team = 'Newcastle Utd';
UPDATE matches SET home_team = 'Nottingham Forest' WHERE home_team = 'Nott''ham Forest';
UPDATE matches SET away_team = 'Nottingham Forest' WHERE away_team = 'Nott''ham Forest';
UPDATE matches SET home_team = 'Tottenham Hotspur' WHERE home_team = 'Tottenham';
UPDATE matches SET away_team = 'Tottenham Hotspur' WHERE away_team = 'Tottenham';
UPDATE matches SET home_team = 'West Ham United' WHERE home_team = 'West Ham';
UPDATE matches SET away_team = 'West Ham United' WHERE away_team = 'West Ham';
UPDATE matches SET home_team = 'Manchester United' WHERE home_team = 'Manchester Utd';
UPDATE matches SET away_team = 'Manchester United' WHERE away_team = 'Manchester Utd';

UPDATE team_match_stats SET team = 'Newcastle United' WHERE team = 'Newcastle Utd';
UPDATE team_match_stats SET opponent = 'Newcastle United' WHERE opponent = 'Newcastle Utd';
UPDATE team_match_stats SET team = 'Nottingham Forest' WHERE team = 'Nott''ham Forest';
UPDATE team_match_stats SET opponent = 'Nottingham Forest' WHERE opponent = 'Nott''ham Forest';
UPDATE team_match_stats SET team = 'Tottenham Hotspur' WHERE team = 'Tottenham';
UPDATE team_match_stats SET opponent = 'Tottenham Hotspur' WHERE opponent = 'Tottenham';
UPDATE team_match_stats SET team = 'West Ham United' WHERE team = 'West Ham';
UPDATE team_match_stats SET opponent = 'West Ham United' WHERE opponent = 'West Ham';
UPDATE team_match_stats SET team = 'Manchester United' WHERE team = 'Manchester Utd';
UPDATE team_match_stats SET opponent = 'Manchester United' WHERE opponent = 'Manchester Utd';

UPDATE player_match_stats SET team = 'Newcastle United' WHERE team = 'Newcastle Utd';
UPDATE player_match_stats SET opponent = 'Newcastle United' WHERE opponent = 'Newcastle Utd';
UPDATE player_match_stats SET team = 'Nottingham Forest' WHERE team = 'Nott''ham Forest';
UPDATE player_match_stats SET opponent = 'Nottingham Forest' WHERE opponent = 'Nott''ham Forest';
UPDATE player_match_stats SET team = 'Tottenham Hotspur' WHERE team = 'Tottenham';
UPDATE player_match_stats SET opponent = 'Tottenham Hotspur' WHERE opponent = 'Tottenham';
UPDATE player_match_stats SET team = 'West Ham United' WHERE team = 'West Ham';
UPDATE player_match_stats SET opponent = 'West Ham United' WHERE opponent = 'West Ham';
UPDATE player_match_stats SET team = 'Manchester United' WHERE team = 'Manchester Utd';
UPDATE player_match_stats SET opponent = 'Manchester United' WHERE opponent = 'Manchester Utd';

UPDATE teams SET name = 'Newcastle United'
WHERE name = 'Newcastle Utd'
	AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'Newcastle United');
UPDATE teams SET name = 'Nottingham Forest'
WHERE name = 'Nott''ham Forest'
	AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'Nottingham Forest');
UPDATE teams SET name = 'Tottenham Hotspur'
WHERE name = 'Tottenham'
	AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'Tottenham Hotspur');
UPDATE teams SET name = 'West Ham United'
WHERE name = 'West Ham'
	AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'West Ham United');
UPDATE teams SET name = 'Manchester United'
WHERE name = 'Manchester Utd'
	AND NOT EXISTS (SELECT 1 FROM teams WHERE name = 'Manchester United');

DELETE FROM teams
WHERE name IN ('Newcastle Utd', 'Nott''ham Forest', 'Tottenham', 'West Ham', 'Manchester Utd');

COMMIT;
