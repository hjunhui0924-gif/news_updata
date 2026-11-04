-- Platform credentials belong to the existing workspace user, not another login identity.
CREATE TABLE platform_connections (
  user_id text NOT NULL REFERENCES app_users(id),
  platform text NOT NULL,
  external_id text,
  name text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  refresh_expires_at timestamptz,
  scope text,
  client_fingerprint text,
  generation text NOT NULL,
  oauth_nonce text,
  state text NOT NULL DEFAULT 'disconnected',
  retry_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);
