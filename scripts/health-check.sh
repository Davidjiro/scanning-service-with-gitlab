#!/usr/bin/env bash
# Read-only check of a deployed environment: does NOT create any orders. Safe for production.
#
#   usage:  ./scripts/health-check.sh [dev|qa|prod]        (default: dev)
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require aws; require curl

ENV_NAME="${1:-dev}"
WEB_URL="$(stack_output "orderflow-${ENV_NAME}-compute" WebAlbUrl)"
echo "WEB: ${WEB_URL}"

# The new tasks may still be registering with the target group: retry for up to ~2 minutes.
for attempt in $(seq 1 24); do
  if curl -fsS -m 5 "${WEB_URL}/health" >/dev/null 2>&1; then
    echo "health: OK"
    curl -fsS "${WEB_URL}/whoami"; echo
    exit 0
  fi
  echo "   attempt ${attempt}/24: not healthy yet"
  sleep 5
done
echo "ERROR: ${WEB_URL}/health never became healthy" >&2
exit 1
