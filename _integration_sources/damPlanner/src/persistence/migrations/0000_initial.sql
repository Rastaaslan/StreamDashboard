CREATE TABLE IF NOT EXISTS planner_events (id text PRIMARY KEY, json text NOT NULL, deleted_at text);
CREATE TABLE IF NOT EXISTS event_publications (event_id text NOT NULL, provider text NOT NULL, json text NOT NULL, PRIMARY KEY(event_id,provider));
CREATE TABLE IF NOT EXISTS sync_attempts (id text PRIMARY KEY, json text NOT NULL);
