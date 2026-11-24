# lib/config/  -  the values

Config files turn "what environment is this?" into concrete **props** (see `../props`). Changing a CIDR, a
retention period or an instance size should only ever need an edit in this directory.

| File | Provides |
|------|----------|
| `environments.ts` | **Single source of truth**: env names, account ids (from env vars), region, **CIDR plan**, AZs, NAT count. Also `resourceName()` for consistent names. |
| `network.config.ts` | `vpcConfigs(env)` -> props for the app, eks, client VPCs; private zone name; Transit Gateway ASN. Documents the subnet math. |
| `data.config.ts` | props for DynamoDB, S3, SQS (+DLQ), SNS. dev = disposable, prod = protected. |
| `compute.config.ts` | props for Lambdas, API Gateway, state machine, the two Fargate services; container/listener ports. |
| `eks.config.ts` | Kubernetes version, node type/count, service CIDR, admin ARNs. |
| `gitlab.config.ts` | which GitLab project/host may deploy, audience, allowed branches per env (dev = any, qa/prod = default branch), role name. |

## Environment variables read here
| Variable | Meaning |
|----------|---------|
| `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION` | set automatically by the CDK CLI from your credentials |
| `CDK_DEV_ACCOUNT`, `CDK_QA_ACCOUNT`, `CDK_PROD_ACCOUNT` | one account per environment; fall back to the default account (the pipeline sets them from the role ARN) |
| `ORDERFLOW_AZ_SUFFIXES` | AZ letters, default `a,b` |
| `EKS_ADMIN_ARNS` | comma separated IAM ARNs granted cluster-admin |
| `ORDERFLOW_NOTIFY_EMAIL` | optional e-mail subscribed to the SNS topic |
| `GITLAB_PROJECT_PATH` (required), `GITLAB_HOST`, `GITLAB_DEFAULT_BRANCH`, `GITLAB_EXISTING_OIDC_PROVIDER_ARN` | `gitlab-access` mode only |

## CIDR plan (never change casually)
```
env   app            eks            client
dev   10.10.0.0/16   10.11.0.0/16   172.16.0.0/16
qa    10.20.0.0/16   10.21.0.0/16   172.17.0.0/16
prod  10.30.0.0/16   10.31.0.0/16   172.18.0.0/16
```
Reserved, never use for a VPC: `172.20.0.0/16` (EKS service CIDR), `169.254.0.0/16` (link-local / Lattice).

Rules: connected VPCs must not overlap; keep environments non-overlapping too; leave room to grow
(a /16 holds 256 /24 subnets and we use six of them).
