CREATE TABLE IF NOT EXISTS personal_ai_settings (
  user_id text PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('site','personal','disabled')),
  revision integer NOT NULL DEFAULT 1,
  encrypted_key text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ai_usage ADD COLUMN IF NOT EXISTS billing_scope text NOT NULL DEFAULT 'site';
