CREATE TABLE IF NOT EXISTS star_sync (
  user_id text PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL DEFAULT '{"page":1,"scanStartedAt":null,"lastSyncAt":null,"lastAdded":0,"error":null}'
);
CREATE TABLE IF NOT EXISTS star_sync_exclusions (
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  PRIMARY KEY(user_id,external_id)
);
