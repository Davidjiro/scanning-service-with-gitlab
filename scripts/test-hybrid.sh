#!/usr/bin/env bash
# Prove the HYBRID path:  Client VPC ("on-prem") -> Transit Gateway -> App VPC -> internal ALB -> Fargate
#
#   usage:  ./scripts/test-hybrid.sh [dev|qa|prod]       (default: dev)
#
# How: we ask AWS Systems Manager to run a curl ON the EC2 box in the client VPC (no SSH, no open ports),
# against the private DNS name internal.<env>.orderflow.internal that only exists in our Route 53 private zone.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require aws

ENV_NAME="${1:-dev}"
INSTANCE_ID="$(stack_output "orderflow-${ENV_NAME}-connectivity" ClientHostInstanceId)"
NAME="internal.${ENV_NAME}.orderflow.internal"
echo "client instance: ${INSTANCE_ID}"
echo "target:          http://${NAME}/whoami"

CMD_ID="$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunShellScript \
  --parameters "commands=[\"getent hosts ${NAME}\",\"curl -sS -m 5 http://${NAME}/whoami\"]" \
  --query 'Command.CommandId' --output text)"

for _ in $(seq 1 20); do
  STATUS="$(aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
            --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in
    Success|Failed|Cancelled|TimedOut) break ;;
  esac
  sleep 3
done

echo "SSM status: ${STATUS}"
aws ssm get-command-invocation --command-id "$CMD_ID" --instance-id "$INSTANCE_ID" \
  --query '{stdout:StandardOutputContent,stderr:StandardErrorContent}' --output text
[ "$STATUS" = "Success" ]
echo "HYBRID CONNECTIVITY OK (the private IP above is inside the App VPC CIDR)"
