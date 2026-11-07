#!/bin/bash
set -euo pipefail

# Install only this application's services; never restart the other hosted projects.
if [ "$(id -u)" -ne 0 ]; then echo 'Run using sudo bash deploy/install-native.sh admin /usr/bin/node' >&2; exit 1; fi
run_user=${1:?Pass the non-root Linux service user}
node_bin=${2:-/usr/bin/node}
project=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
id "$run_user" >/dev/null
"$node_bin" -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
for artifact in .next/standalone/server.js dist/worker/main.js dist/migrate/migrate-production.js; do
  test -f "$project/$artifact" || { echo 'Build artifacts missing; run pnpm build as the project owner first.' >&2; exit 1; }
done
runuser -u "$run_user" -- "$node_bin" "$project/deploy/native-services.mjs" "$project" "$run_user" "$node_bin"

install -d -m 0700 /etc/newsroom
if [ ! -f /etc/newsroom/runtime.env ]; then
  install -o root -g root -m 0600 "$project/deploy/native.env" /etc/newsroom/runtime.env
else
  echo 'Keeping /etc/newsroom/runtime.env; edit it explicitly to change runtime settings.'
fi
cd -- "$project"
"$node_bin" deploy/init-native-database.mjs

for name in migrate web worker; do
  install -o root -g root -m 0644 "work/native-services/newsroom-$name.service" /etc/systemd/system/
done
install -d -o postgres -g postgres -m 0700 /var/backups/newsroom
install -o root -g postgres -m 0750 deploy/native-backup.sh /usr/local/sbin/newsroom-pg-backup
install -o root -g root -m 0644 deploy/newsroom-pg-backup.service deploy/newsroom-pg-backup.timer /etc/systemd/system/
systemctl daemon-reload
# Migrations run once per installation/update, before either application process starts.
systemctl start newsroom-pg-backup.service
systemctl stop newsroom-web.service newsroom-worker.service
systemctl restart newsroom-migrate.service
systemctl enable newsroom-web.service newsroom-worker.service newsroom-pg-backup.timer
systemctl start newsroom-web.service newsroom-worker.service newsroom-pg-backup.timer
systemctl start newsroom-pg-backup.service
systemctl --no-pager --full status newsroom-web.service newsroom-worker.service
echo 'Native deployment started. Check journalctl -u newsroom-web -u newsroom-worker and the public page.'
