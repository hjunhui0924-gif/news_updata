CREATE TABLE IF NOT EXISTS ai_cache (key text PRIMARY KEY, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
