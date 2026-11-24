# apps/eks/  -  Kubernetes manifest

`deployment.yaml` creates namespace `orderflow` and two Deployments + Services that run the **same image** as ECS:

| Deployment | Calls | Network path being proven |
|------------|-------|---------------------------|
| `peering-client` | `http://internal.<env>.orderflow.internal` | EKS VPC -> **VPC peering** -> App VPC -> internal ALB |
| `lattice-client` | `http://<service>.vpc-lattice-svcs.<region>.on.aws` | **VPC Lattice** service network (no routes) |

It contains `${PLACEHOLDERS}` (image, env name, URLs) that `envsubst` fills in. Do not `kubectl apply` it raw.
Use the helper, which reads the values from CloudFormation outputs:

```bash
../../scripts/deploy-eks-workloads.sh dev
```

## Manual version (step by step)
```bash
aws eks update-kubeconfig --name orderflow-dev-eks --region us-east-1
export ENV_NAME=dev
export IMAGE_URI=$(aws cloudformation describe-stacks --stack-name orderflow-dev-compute \
  --query "Stacks[0].Outputs[?OutputKey=='ImageUri'].OutputValue" --output text)
export PEERING_URL=http://internal.dev.orderflow.internal
export LATTICE_URL=$(aws cloudformation describe-stacks --stack-name orderflow-dev-discovery \
  --query "Stacks[0].Outputs[?OutputKey=='LatticeServiceUrl'].OutputValue" --output text)
envsubst '${IMAGE_URI} ${ENV_NAME} ${PEERING_URL} ${LATTICE_URL}' < deployment.yaml | kubectl apply -f -
kubectl -n orderflow get pods -o wide        # note: the pod IPs are inside 10.11.16.0/20 (real VPC IPs)
kubectl -n orderflow port-forward svc/peering-client 8081:80 &
curl localhost:8081/peer-check
```

## Design notes
- **Pod IPs are VPC IPs** (AWS VPC CNI): that is why the EKS private subnets are /20.
- Probes use `/health`; resource requests/limits are set; the container runs as non-root.
- The pods have no AWS credentials. They only make HTTP calls, so no IRSA / Pod Identity is needed here.
  (Know the difference: IRSA uses the cluster's OIDC provider; Pod Identity uses an agent + EKS API association.)
