#!/usr/bin/env bash
# Deploy the two test pods to EKS and prove BOTH cross-VPC paths from inside the cluster.
#
#   usage:  ./scripts/deploy-eks-workloads.sh [dev|qa|prod]      (default: dev)
#
#   pod "peering-client" calls  http://internal.<env>.orderflow.internal   -> VPC PEERING
#   pod "lattice-client" calls  http://<lattice-dns-name>            -> VPC LATTICE
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require aws; require kubectl; require envsubst; require curl

ENV_NAME="${1:-dev}"
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region || echo us-east-1)}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

CLUSTER="orderflow-${ENV_NAME}-eks"
export ENV_NAME
IMAGE_URI="$(stack_output "orderflow-${ENV_NAME}-compute" ImageUri)"
LATTICE_URL="$(stack_output "orderflow-${ENV_NAME}-discovery" LatticeServiceUrl)"
export IMAGE_URI LATTICE_URL
export PEERING_URL="http://internal.${ENV_NAME}.orderflow.internal"

echo "cluster:     ${CLUSTER}"
echo "image:       ${IMAGE_URI}"
echo "peering url: ${PEERING_URL}"
echo "lattice url: ${LATTICE_URL}"

aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION" >/dev/null

# Only substitute OUR variables so any other $ in the YAML is left untouched.
envsubst '${IMAGE_URI} ${ENV_NAME} ${PEERING_URL} ${LATTICE_URL}' < "${ROOT}/apps/eks/deployment.yaml" | kubectl apply -f -

kubectl -n orderflow rollout status deploy/peering-client --timeout=180s
kubectl -n orderflow rollout status deploy/lattice-client --timeout=180s

# Reach the pods from the laptop with port-forward, then ask each pod to call the upstream.
kubectl -n orderflow port-forward svc/peering-client 8081:80 >/dev/null 2>&1 &  PF1=$!
kubectl -n orderflow port-forward svc/lattice-client 8082:80 >/dev/null 2>&1 &  PF2=$!
trap 'kill $PF1 $PF2 2>/dev/null || true' EXIT
sleep 3

echo; echo "== EKS pod -> VPC PEERING -> internal ALB =="
curl -fsS http://localhost:8081/peer-check; echo
echo; echo "== EKS pod -> VPC LATTICE -> internal ALB =="
curl -fsS http://localhost:8082/peer-check; echo
echo; echo "Both paths answered. 'upstream_answer.role' = internal  =>  the ECS 'internal' service replied."
