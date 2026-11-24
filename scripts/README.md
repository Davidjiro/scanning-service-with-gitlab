# scripts/  -  verify that it works

All scripts take the environment name as the first argument (default `dev`), read what they need from
CloudFormation outputs, and exit non-zero on failure.

| Script | Proves | Needs |
|--------|--------|-------|
| `smoke-test.sh` | public ALB -> ECS; API Gateway -> Lambda -> SNS -> SQS -> Lambda -> Step Functions -> DynamoDB/S3; the REJECTED branch; API request validation | aws, curl, python3 |
| `test-hybrid.sh` | Client VPC ("on-prem") -> Transit Gateway -> App VPC -> internal ALB (via SSM Run Command, no SSH) | aws |
| `deploy-eks-workloads.sh` | EKS pod -> peering -> internal ALB, and EKS pod -> VPC Lattice -> internal ALB | aws, kubectl, envsubst, curl |
| `health-check.sh` | read-only check that the public ALB answers (used for **prod**, where creating orders is unwanted) | aws, curl |
| `lib.sh` | helper functions (`stack_output`, `require`); sourced by the others | - |

```bash
./scripts/smoke-test.sh dev
./scripts/test-hybrid.sh dev
./scripts/deploy-eks-workloads.sh dev
./scripts/health-check.sh prod      # read-only
```

The GitLab pipeline runs `smoke-test.sh` after dev and qa, and `health-check.sh` after prod.
