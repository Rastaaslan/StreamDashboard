-- Additive migration: existing planner events and publications remain untouched.
CREATE TABLE IF NOT EXISTS event_templates (id text PRIMARY KEY, json text NOT NULL);
CREATE TABLE IF NOT EXISTS notification_log (key text PRIMARY KEY, notified_at text NOT NULL);
