-- Additive only: existing planner_events JSON remains valid through Zod defaults.
CREATE TABLE IF NOT EXISTS live_routines (id text PRIMARY KEY, json text NOT NULL);
CREATE TABLE IF NOT EXISTS participants (id text PRIMARY KEY, json text NOT NULL);
CREATE TABLE IF NOT EXISTS event_tags (id text PRIMARY KEY, json text NOT NULL);
CREATE TABLE IF NOT EXISTS local_action_targets (id text PRIMARY KEY, json text NOT NULL);
CREATE TABLE IF NOT EXISTS action_audit (id text PRIMARY KEY, json text NOT NULL);
