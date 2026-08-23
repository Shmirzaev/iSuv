CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS system_metadata (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
