#!/bin/sh
set -eu
umask 077
dump=${1:-}
case "$dump" in /backups/news-*.dump) ;; *) echo 'Provide a backup produced by this service.' >&2; exit 1;; esac
[ -f "$dump" ] && [ -f "$dump.sha256" ] || exit 1
sha256sum -c "$dump.sha256" >/dev/null
nonce=$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
target="news_restore_drill_$(date -u +%Y%m%d%H%M%S)_$nonce"
created=false
cleanup() {
  if [ "$created" = true ]; then dropdb --if-exists --maintenance-db=postgres "$target"; fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
existing=$(psql --dbname=postgres --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align --command="SELECT 1 FROM pg_database WHERE datname='$target'")
[ -z "$existing" ] || { echo 'Restore target already exists; refusing to use it.' >&2; exit 1; }
# Register cleanup before the round trip: a lost response must not leak a restored database.
created=true
createdb --maintenance-db=postgres "$target"
pg_restore --exit-on-error --no-owner --no-acl --dbname="$target" "$dump"
psql --dbname="$target" --no-psqlrc --set=ON_ERROR_STOP=1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_migrations WHERE name='0007_service_guards.sql') THEN
    RAISE EXCEPTION 'Required migration is missing';
  END IF;
  IF EXISTS(SELECT 1 FROM items i LEFT JOIN app_users u ON u.id=i.user_id WHERE u.id IS NULL) THEN
    RAISE EXCEPTION 'Orphaned content';
  END IF;
END $$;
SELECT (SELECT count(*) FROM app_migrations) AS migrations,
       (SELECT count(*) FROM app_users) AS users,
       count(*) AS items,
       count(*) FILTER(WHERE read) AS read,
       count(*) FILTER(WHERE saved) AS saved FROM items;
SQL
echo 'Isolated restore drill completed; temporary database will be removed.'
