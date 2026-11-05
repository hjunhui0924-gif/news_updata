-- One bounded set of buckets per admitted user. Never store IPs, tokens or arbitrary URL keys.
CREATE TABLE IF NOT EXISTS request_limits (
  user_id text NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('read', 'write', 'external', 'ai')),
  used integer NOT NULL CHECK (used > 0),
  reset_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, scope)
);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage(created_at);
