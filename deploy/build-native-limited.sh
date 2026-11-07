#!/bin/bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo 'Run with sudo bash deploy/build-native-limited.sh admin /opt/newsroom-node24/bin/node' >&2; exit 1; fi
run_user=${1:?Pass the non-root project owner}
node_bin=${2:-/opt/newsroom-node24/bin/node}
project=$(cd -- "$(dirname -- "$0")/.." && pwd -P)
id "$run_user" >/dev/null
[ "$run_user" != root ] || { echo 'Use the non-root project owner.' >&2; exit 1; }
test -f /sys/fs/cgroup/cgroup.controllers || { echo 'cgroup v2 is required for the bounded build. Do not retry an unbounded build.' >&2; exit 1; }
test -f "$project/node_modules/next/dist/bin/next"
"$node_bin" -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
for service in newsroom-web newsroom-worker; do
  if systemctl is-active --quiet "$service"; then
    echo "Stop $service before rebuilding its current artifacts." >&2
    exit 1
  fi
done
runuser -u "$run_user" -- mkdir -p "$project/work"
# An independent service survives SSH disconnection. Limits cover all children.
unit="newsroom-build-$(date +%s)"
systemd-run --unit="$unit" --service-type=oneshot --remain-after-exit --no-block \
  --uid="$run_user" --working-directory="$project" \
  --property=MemoryAccounting=yes --property=MemoryHigh=700M \
  --property=MemoryMax=900M --property=MemorySwapMax=512M \
  --property=CPUQuota=80% --property=TasksMax=128 \
  --property=OOMPolicy=kill --property=Nice=10 \
  --property=TimeoutStartSec=30min \
  --setenv=APP_MODE=live --setenv=APP_URL=http://127.0.0.1:8003 \
  --setenv=BETTER_AUTH_SECRET=build-only-placeholder-never-use-for-login \
  --setenv=ALLOWED_GITHUB_USER_IDS=0 \
  --setenv="PATH=$(dirname -- "$node_bin"):/usr/local/bin:/usr/bin:/bin" \
  /usr/bin/flock --nonblock "$project/work/native-build.lock" \
  "$node_bin" "$project/scripts/build-low-memory.mjs"
echo "Follow logs: sudo journalctl -fu $unit"
echo "Check result: sudo systemctl show $unit -p ActiveState -p SubState -p Result -p ExecMainStatus"
echo 'Install services only after Result=success, ExecMainStatus=0 and SubState=exited.'
