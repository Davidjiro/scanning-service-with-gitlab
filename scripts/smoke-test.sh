#!/usr/bin/env bash
# End-to-end smoke test of the order pipeline for one environment.
#
#   usage:  ./scripts/smoke-test.sh [dev|qa|prod]        (default: dev)
#
# What it proves:
#   1. The public ALB + ECS service answer          (ALB -> target group -> Fargate)
#   2. API Gateway -> Lambda -> DynamoDB + SNS      (POST /orders)
#   3. SNS -> SQS -> worker Lambda -> Step Functions -> DynamoDB/S3  (status becomes PROCESSED)
#   4. The REJECTED path of the state machine       (quantity 101 passes the API schema but fails validation)
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require aws; require curl; require python3

ENV_NAME="${1:-dev}"
COMPUTE_STACK="orderflow-${ENV_NAME}-compute"

API_URL="$(stack_output "$COMPUTE_STACK" ApiUrl)"       # ends with a slash
WEB_URL="$(stack_output "$COMPUTE_STACK" WebAlbUrl)"
echo "API: ${API_URL}"
echo "WEB: ${WEB_URL}"

echo; echo "== 1) Public ALB -> ECS =="
curl -fsS "${WEB_URL}/health"; echo
curl -fsS "${WEB_URL}/whoami"; echo

json_field() { python3 -c "import sys,json; print(json.load(sys.stdin)['$1'])"; }

wait_for_status() {  # wait_for_status <orderId> <expected-status>
  local id="$1" want="$2" status="?"
  for _ in $(seq 1 30); do
    status="$(curl -fsS "${API_URL}orders/${id}" | json_field status)"
    echo "   status=${status}"
    [ "$status" = "$want" ] && return 0
    sleep 3
  done
  echo "TIMEOUT: order ${id} never reached ${want} (last: ${status})" >&2
  return 1
}

echo; echo "== 2+3) Happy path: create order and wait for PROCESSED =="
ID="$(curl -fsS -X POST "${API_URL}orders" -H 'Content-Type: application/json' \
      -d '{"item":"book","quantity":2}' | json_field orderId)"
echo "   created ${ID}"
wait_for_status "$ID" PROCESSED

echo; echo "== 4) Rejected path: quantity 101 =="
BAD="$(curl -fsS -X POST "${API_URL}orders" -H 'Content-Type: application/json' \
       -d '{"item":"too-many","quantity":101}' | json_field orderId)"
echo "   created ${BAD}"
wait_for_status "$BAD" REJECTED

echo; echo "== API Gateway request validation: a bad body must be rejected with HTTP 400 =="
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API_URL}orders" \
        -H 'Content-Type: application/json' -d '{"item":"x"}')"
echo "   HTTP ${CODE} (expected 400)"
[ "$CODE" = "400" ]

echo; echo "ALL CHECKS PASSED for ${ENV_NAME}"
