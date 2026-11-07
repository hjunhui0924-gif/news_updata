#!/bin/sh
set -eu
umask 077

backup_dir=/var/backups/newsroom
retention_days=${BACKUP_RETENTION_DAYS:-14}
case "$retention_days" in ''|*[!0-9]*) echo 'Invalid backup retention.' >&2; exit 1;; esac
[ "$retention_days" -ge 1 ] && [ "$retention_days" -le 365 ] || exit 1

stamp=$(date -u +%Y%m%dT%H%M%SZ)
part="$backup_dir/news-$stamp-$$.partial"
final="$backup_dir/news-$stamp-$$.dump"
trap 'rm -f "$part"' EXIT HUP INT TERM
pg_dump --dbname=news --format=custom --no-owner --no-acl --file="$part"
pg_restore --list "$part" >/dev/null
mv "$part" "$final"
sha256sum "$final" > "$final.sha256"
find "$backup_dir" -maxdepth 1 -type f -name 'news-*.dump' -mtime "+$retention_days" -delete
find "$backup_dir" -maxdepth 1 -type f -name 'news-*.dump.sha256' -mtime "+$retention_days" -delete
echo 'Native PostgreSQL backup completed.'
