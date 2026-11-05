#!/bin/sh
set -eu
umask 077
retention=${BACKUP_RETENTION_DAYS:-7}
case "$retention" in ''|*[!0-9]*) echo 'Invalid backup retention.' >&2; exit 1;; esac
[ "$retention" -ge 1 ] && [ "$retention" -le 365 ] || exit 1

backup_once() (
  set -eu
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  part="/backups/news-$stamp-$$.partial"
  final="/backups/news-$stamp-$$.dump"
  trap 'rm -f "$part"' EXIT HUP INT TERM
  # Explicit exits matter: POSIX shells may suppress errexit inside an if-called function.
  pg_dump --format=custom --no-owner --no-acl --file="$part" || exit 1
  pg_restore --list "$part" >/dev/null || exit 1
  mv "$part" "$final" || exit 1
  sha256sum "$final" > "$final.sha256" || exit 1
  date +%s > /backups/.last-success.tmp || exit 1
  mv /backups/.last-success.tmp /backups/.last-success || exit 1
  # This volume contains only this service's timestamped backups. Never delete by a supplied path.
  find /backups -maxdepth 1 -type f -name 'news-*.dump' -mtime +"$retention" -delete
  find /backups -maxdepth 1 -type f -name 'news-*.dump.sha256' -mtime +"$retention" -delete
  echo 'Database backup completed.'
)

if [ "${1:-}" = once ]; then backup_once; exit; fi
while :; do
  if backup_once; then sleep 86400; else echo 'Database backup failed; retry scheduled.' >&2; sleep 3600; fi
done
