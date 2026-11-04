-- Existing JSON and IDs remain readable; old clients omit platform and default to GitHub.
ALTER TABLE subscriptions ADD COLUMN platform text NOT NULL DEFAULT 'github';
UPDATE subscriptions SET data = data || jsonb_build_object('platform', platform);
UPDATE items SET data = data || jsonb_build_object('platform', 'github') WHERE NOT data ? 'platform';
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_kind_external_id_key;
DROP INDEX IF EXISTS subscription_identity;
CREATE UNIQUE INDEX subscription_identity ON subscriptions(user_id, platform, kind, external_id);
