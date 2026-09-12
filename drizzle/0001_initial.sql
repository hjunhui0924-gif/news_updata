CREATE TABLE IF NOT EXISTS app_users (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS subscriptions (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), external_id text NOT NULL,
  kind text NOT NULL, data jsonb NOT NULL, UNIQUE(user_id,kind,external_id)
);
CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), source_id text NOT NULL,
  external_key text NOT NULL, data jsonb NOT NULL, published_at timestamptz NOT NULL,
  read boolean NOT NULL DEFAULT false, saved boolean NOT NULL DEFAULT false, muted boolean NOT NULL DEFAULT false,
  UNIQUE(user_id,external_key)
);
CREATE INDEX IF NOT EXISTS items_feed_idx ON items(user_id,published_at DESC,id);
CREATE TABLE IF NOT EXISTS preferences (user_id text PRIMARY KEY REFERENCES app_users(id), data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), kind text NOT NULL, target_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending', error text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), enqueued_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS active_job_idx ON jobs(user_id,kind,target_id) WHERE status IN ('pending','running');
CREATE TABLE IF NOT EXISTS ai_usage (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), cost numeric NOT NULL,
  status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES app_users(id), period_key text NOT NULL,
  data jsonb NOT NULL, UNIQUE(user_id,period_key)
);
CREATE TABLE IF NOT EXISTS notification_items (
  user_id text NOT NULL REFERENCES app_users(id), item_id text NOT NULL,
  batch_id text NOT NULL REFERENCES notifications(id), PRIMARY KEY(user_id,item_id)
);
CREATE TABLE IF NOT EXISTS system_state (key text PRIMARY KEY, value jsonb NOT NULL);

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL,
  image text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS session (
  id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
  "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS account_user_idx ON account("userId");
CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
  "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz, "updatedAt" timestamptz
);
