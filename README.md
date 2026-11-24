# OrderFlow on AWS, delivered with GitLab CI/CD

OrderFlow processes orders through an event-driven pipeline and serves them from containers on **ECS Fargate** and **EKS**,
across three VPCs. Everything is infrastructure as code in **TypeScript CDK** (`infra/`); the application code is small
**Python** services (`apps/`). A **GitLab CI/CD** pipeline (`.gitlab-ci.yml`) validates, then deploys dev, qa and prod into
separate AWS accounts.

What it demonstrates:
- **Networking:** three non-overlapping VPCs with public, private and isolated tiers; VPC peering, a Transit Gateway hub
  for a simulated on-premises network, VPC Lattice, and a Route 53 private hosted zone shared by all three.
- **Event-driven processing:** API Gateway, Lambda, SNS with filter policies, SQS with a dead-letter queue, and a Step Functions
  state machine that writes to DynamoDB and S3.
- **Containers:** the same image on ECS Fargate behind public and internal ALBs, and on EKS.
- **Delivery without stored keys:** GitLab's OIDC token is exchanged for short-lived AWS credentials. The role in each account
  can only assume the CDK bootstrap roles, and only for this project's allowed branches.

> Start by reading **[ARCHITECTURE.md](ARCHITECTURE.md)** (diagram, CIDR plan, data flow).

```
.
├── ARCHITECTURE.md        <- the architecture drawing + explanations
├── README.md              <- you are here: prerequisites + how to deploy
├── infra/                 <- CDK app (TypeScript)
│   ├── bin/app.ts         <- ENTRY POINT: joins everything (direct deploy or one-time gitlab-access)
│   └── lib/
│       ├── props/         <- interfaces: the contract of each construct
│       ├── config/        <- values that fill those interfaces, per environment
│       ├── constructs/    <- level-3 constructs (one per AWS building block)
│       ├── stacks/        <- 6 application stacks + 1 one-time GitLab access stack
│       └── stages/        <- AppStage: all stacks of ONE environment
├── .gitlab-ci.yml         <- THE PIPELINE: validate -> dev -> qa -> prod
├── ci/                    <- helper scripts used by the pipeline (OIDC login, tool install)
├── apps/                  <- Python code that the compute resources run
│   ├── service/           <- FastAPI container (ECS Fargate AND EKS)
│   ├── lambdas/           <- api_handler, validate, worker
│   └── eks/               <- Kubernetes manifest
└── scripts/               <- smoke tests and EKS helper
```

Every directory has its own `README.md`.

---

## 1. Cost warning (read first)

One environment runs a NAT gateway, two ALBs, an EKS control plane + 2 nodes and two Transit Gateway
attachments. Expect **roughly $8-10 per day**. Deploy, test, then **destroy** (section 8).
Prices change: check the AWS pricing pages. Set a budget alert in the Billing console.

---

## 2. Prerequisites (install these locally)

| Tool | Why | Check |
|------|-----|-------|
| **Node.js 20+** (tested with 24) and npm | runs the CDK app | `node -v` |
| **AWS CLI v2** | credentials, bootstrap, outputs | `aws --version` |
| **AWS CDK CLI** | `cdk synth/deploy` | `npm install -g aws-cdk` then `cdk --version` |
| **Docker Desktop (running!)** | CDK builds the container image during deploy | `docker info` |
| **kubectl** | talk to the EKS cluster | `kubectl version --client` |
| **gettext (`envsubst`)** | fills the Kubernetes manifest | `envsubst --version` |
| **Python 3.12+** | local experiments only (not needed to deploy) | `python3 --version` |
| **Session Manager plugin** | optional: interactive shell on the test box | `session-manager-plugin` |
| **git** | the pipeline runs from a GitLab repo | `git --version` |

macOS with Homebrew:
```bash
brew install node awscli kubectl gettext git
brew install --cask docker                 # then start Docker Desktop
brew install --cask session-manager-plugin # optional
npm install -g aws-cdk
```

You also need:
- **An AWS account** and credentials on the CLI. Verify: `aws sts get-caller-identity`.
  (One account is enough to deploy `dev` by hand. The GitLab pipeline demo needs three, see section 7.)
- A **GitLab** project (gitlab.com or self-managed) for section 7. Not needed for a manual deploy.
- IAM permissions to create VPC, EKS, ECS, IAM, Lambda, API Gateway etc. An administrator role is the simplest for a first deployment.
- The default region is **us-east-1**. Change with `export CDK_DEFAULT_REGION=eu-west-1`.
  Apple Silicon and Intel both work: images are built for ARM64 using Docker's cross-build support.

---

## 3. Deploy the `dev` environment (single account)

```bash
cd infra
npm ci                                        # install exact dependency versions

# 3a) Who am I? Put your IAM identity in EKS_ADMIN_ARNS so that you can use kubectl later.
aws sts get-caller-identity --query Arn --output text
#   arn:aws:iam::123456789012:user/me          -> use as is
#   arn:aws:sts::123456789012:assumed-role/RoleName/session  -> use arn:aws:iam::123456789012:role/RoleName
#       (IAM Identity Center / SSO: use the real role ARN INCLUDING its path, e.g.
#        arn:aws:iam::123456789012:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_<name>_<id>.
#        The old aws-auth ConfigMap needed the path removed; EKS Access Entries do not. SSO has not been tested with this project.)
export EKS_ADMIN_ARNS="arn:aws:iam::123456789012:user/me"

# 3b) One-time per account+region: creates the CDK toolkit stack (S3 bucket, ECR repo, IAM roles).
npx cdk bootstrap

# 3c) See what will be created (no AWS changes):
npx cdk synth "dev/*" --quiet
npx cdk ls                                    # lists the 6 stacks

# 3d) Deploy. About 25-35 minutes (EKS and Transit Gateway are the slow parts).
npx cdk deploy "dev/*" --require-approval never --concurrency 3
```

`cdk deploy` **builds the Docker image** from `apps/service` and pushes it to ECR, so Docker must be running.

The 6 stacks are deployed in dependency order automatically:
`orderflow-dev-network` + `orderflow-dev-data` -> `orderflow-dev-connectivity`, `orderflow-dev-eks`, `orderflow-dev-compute` -> `orderflow-dev-discovery`.

Show every output (URLs, IDs):
```bash
for s in network connectivity data compute eks discovery; do
  echo "== orderflow-dev-$s"; aws cloudformation describe-stacks --stack-name orderflow-dev-$s \
    --query 'Stacks[0].Outputs[].[OutputKey,OutputValue]' --output text; done
```

---

## 4. See it work

### 4a. Serverless order flow + public ALB (automatic test)
```bash
./scripts/smoke-test.sh dev
```
It creates an order through **API Gateway**, waits for it to become `PROCESSED` (SNS -> SQS -> worker Lambda
-> Step Functions -> DynamoDB + S3), proves the `REJECTED` branch, API request validation (HTTP 400),
and the public **ALB -> ECS** path.

Look at the evidence in the console (or CLI):
```bash
# Step Functions executions and their graph
aws stepfunctions list-executions --state-machine-arn "$(aws cloudformation describe-stacks --stack-name orderflow-dev-compute --query "Stacks[0].Outputs[?OutputKey=='StateMachineArn'].OutputValue" --output text)" --max-items 5
# Receipts written by the state machine
aws s3 ls "s3://$(aws cloudformation describe-stacks --stack-name orderflow-dev-data --query "Stacks[0].Outputs[?OutputKey=='ReceiptsBucketName'].OutputValue" --output text)/receipts/"
```

### 4b. Hybrid path: "on-prem" -> Transit Gateway -> App VPC
```bash
./scripts/test-hybrid.sh dev
```
Runs `curl http://internal.dev.orderflow.internal/whoami` **on the EC2 box in the Client VPC** (172.16.0.0/16).
The answer proves the packet crossed the **Transit Gateway** to the **internal ALB**. For an interactive shell:
`aws ssm start-session --target <ClientHostInstanceId>`.

### 4c. EKS in its own VPC: peering and VPC Lattice
```bash
./scripts/deploy-eks-workloads.sh dev
```
Deploys two pods and calls the internal service two different ways:
- `peering-client` -> `internal.dev.orderflow.internal` -> **VPC peering** (EKS VPC <-> App VPC)
- `lattice-client` -> `<name>.vpc-lattice-svcs...on.aws` -> **VPC Lattice** (no routes at all)

If `kubectl` says *Unauthorized*, your IAM identity is not in `EKS_ADMIN_ARNS` (see 3a). Fix it and run
`npx cdk deploy "dev/orderflow-dev-eks"` again (an Access Entry is created).

---

## 5. Useful CDK commands

| Command | What it does |
|---------|--------------|
| `npx cdk ls` | list stacks |
| `npx cdk synth "dev/*"` | generate CloudFormation into `cdk.out/` |
| `npx cdk diff "dev/*"` | what would change vs. what is deployed |
| `npx cdk deploy "dev/orderflow-dev-compute"` | deploy ONE stack (its dependencies must already exist) |
| `npx cdk deploy "qa/*" -c stage=qa` | deploy another environment (needs `-c stage=`) |
| `npx cdk destroy "dev/*"` | delete everything (section 8) |

---

## 6. Environments and the CIDR plan

All values live in [`infra/lib/config/environments.ts`](infra/lib/config/environments.ts):

| Env  | App VPC       | EKS VPC       | Client VPC   | NAT | Manual approval |
|------|---------------|---------------|--------------|-----|-----------------|
| dev  | 10.10.0.0/16  | 10.11.0.0/16  | 172.16.0.0/16 | 1  | no  |
| qa   | 10.20.0.0/16  | 10.21.0.0/16  | 172.17.0.0/16 | 1  | yes |
| prod | 10.30.0.0/16  | 10.31.0.0/16  | 172.18.0.0/16 | 2  | yes |

No two VPCs overlap, so peering, Transit Gateway and any future cross-environment link just work.

---

## 7. GitLab CI/CD pipeline (dev -> qa -> prod)

The pipeline is [`.gitlab-ci.yml`](.gitlab-ci.yml). It deploys each environment into **its own AWS account**.

```
merge request :  validate  +  cdk diff (dev, read-only)
default branch:  validate -> deploy dev -> smoke test -> [manual] deploy qa -> smoke test -> [manual] deploy prod -> health check
```

**No AWS keys are stored in GitLab.** Each job receives a short-lived OIDC token and exchanges it for temporary
credentials of an IAM role (details in [ci/README.md](ci/README.md)). Needs **three AWS accounts** (`dev`, `qa`,
`prod`); there is no "tooling" account because GitLab runs outside AWS.

### One-time setup (per environment account)
Do this with your own admin credentials for each account in turn. Shown for `dev`; repeat for `qa` and `prod`.

```bash
cd infra
npm ci

# 1) Which GitLab project may deploy? (its path in the URL: gitlab.com/<this part>)
export GITLAB_PROJECT_PATH="my-group/gitlab-aws-app"
#    self-managed GitLab:  export GITLAB_HOST="gitlab.mycompany.com"   (and change `aud:` in .gitlab-ci.yml)

# 2) Credentials of the DEV account, then bootstrap CDK (a normal bootstrap: no --trust needed)
npx cdk bootstrap

# 3) Create the OIDC provider + deploy role for this account
npx cdk deploy orderflow-dev-gitlab-access -c mode=gitlab-access -c stage=dev
#    -> output DeployRoleArn = arn:aws:iam::<dev-account>:role/orderflow-dev-gitlab-deploy
```
Repeat with `-c stage=qa` (stack `orderflow-qa-gitlab-access`) and `-c stage=prod` using each account's credentials.

If the account already has a GitLab OIDC provider (error `EntityAlreadyExists`), reuse it:
`export GITLAB_EXISTING_OIDC_PROVIDER_ARN=arn:aws:iam::<account>:oidc-provider/gitlab.com`.

### GitLab project setup
1. Push this repository to GitLab (`infra/`, `apps/`, `ci/`, `scripts/` and `.gitlab-ci.yml` at the root).
2. **Settings > CI/CD > Variables** (mark them *Protected* if you protect your default branch). None is a credential:

   | Variable | Value |
   |----------|-------|
   | `AWS_ROLE_ARN_DEV` / `AWS_ROLE_ARN_QA` / `AWS_ROLE_ARN_PROD` | the `DeployRoleArn` outputs from above |
   | `EKS_ADMIN_ARNS` | IAM ARNs that get cluster-admin on EKS (comma separated) |
   | `CDK_DEFAULT_REGION` | optional, default `us-east-1` |
   | `ORDERFLOW_NOTIFY_EMAIL` | optional |

3. **Settings > Repository > Protected branches**: protect `main`.
   **Settings > CI/CD > Protected environments**: protect `prod` (and `qa`) and choose who may deploy/approve.
4. Push to `main`. `dev` deploys automatically (the first run takes 25-35 minutes). When `test-dev` is green,
   the pipeline pauses at `deploy-qa`: click **Run** (play button). Same for `deploy-prod`.

The CDK-bootstrapped accounts are required before the first pipeline run (`cdk bootstrap` above).

### Safety nets built in
- The `qa` and `prod` roles can only be assumed by the **default branch** of **your project** (checked by AWS, not by YAML).
- The `dev` role accepts any branch so merge requests can run `cdk diff`; it still cannot touch qa/prod accounts.
- `resource_group` prevents two deployments to the same environment at once.
- The role can only assume the CDK bootstrap roles, it is not an administrator.

## 8. Tear down (stop the bill)

```bash
cd infra
npx cdk destroy "dev/*" --force
```
- Destroy order is automatic (reverse of deploy). If a stack fails to delete, read the CloudFormation events;
  the usual cause is a leftover ENI from a deleted Lambda/ECS task: wait 10 minutes and retry.
- `dev`/`qa` tables and buckets are `DESTROY`; **prod keeps data** (`RETAIN`) and has termination protection.
- The `orderflow-<env>-gitlab-access` stack (OIDC provider + deploy role) is NOT removed by `destroy "dev/*"` on purpose.
  Delete it separately when you are done: `npx cdk destroy orderflow-dev-gitlab-access -c mode=gitlab-access -c stage=dev`
  (needs `GITLAB_PROJECT_PATH` set, like when you deployed it).
- Remove the bootstrap stack `CDKToolkit` only if you will never use CDK in that account again.

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Docker daemon is not running` during deploy | Start Docker Desktop. |
| `kubectl`: *You must be logged in / Unauthorized* | Your identity is not in `EKS_ADMIN_ARNS`; set it and redeploy `orderflow-dev-eks`. |
| `Unsupported Kubernetes version` | Pick a supported one in `lib/config/eks.config.ts` (`aws eks describe-cluster-versions`). |
| Deploy fails: AZ `us-east-1b` not available | Set `ORDERFLOW_AZ_SUFFIXES="a,c"` (AZ names differ per account). |
| `cdk deploy` says *This stack uses assets, so the toolkit stack must be deployed* | Run `npx cdk bootstrap`. |
| Order stays `NEW` | Look at the SQS DLQ and the worker Lambda logs in CloudWatch. |
| Lattice call returns 503 / times out | The ALB SG must allow the Lattice prefix list (created in `orderflow-dev-discovery`). Check target health in the Lattice console. |
| `curl internal.dev.orderflow.internal` fails from the client box | The private zone must be associated with the Client VPC and the TGW routes must exist (`orderflow-dev-connectivity`). |
| Job fails: *Not authorized to perform sts:AssumeRoleWithWebIdentity* | The project path in `GITLAB_PROJECT_PATH` is wrong, the branch is not allowed for that env (qa/prod = default branch only), or `aud:` in `.gitlab-ci.yml` differs from the provider audience. |
| Job fails: `AWS_ROLE_ARN_QA is not set` | Add the CI/CD variable (section 7). Protected variables are only exposed on protected branches. |
| `cdk deploy` fails: *no bootstrap stack / SSM parameter /cdk-bootstrap/...* | Run `npx cdk bootstrap` in that account. |
| Image build very slow in CI | Your runner is x86; see the RUNNERS note at the top of `.gitlab-ci.yml`. |

---

## 10. Design decisions and production hardening

The reasoning behind each choice is in [ARCHITECTURE.md](ARCHITECTURE.md), [ci/README.md](ci/README.md) and the header of each construct
in `infra/lib/constructs/`.

| Area | In this project | For production |
|------|-----------------|----------------|
| Delivery | GitLab OIDC role per account that can only assume the CDK bootstrap roles; manual gates before qa and prod | Protected environments with required approvers; separate roles for plan and deploy |
| Connectivity | Peering for EKS to app, Transit Gateway for the client network, Lattice for service-level access | Choose per use case: peering is non-transitive, Transit Gateway scales to many VPCs, Lattice needs no routes |
| Edge | HTTP listeners (no registered domain) | ACM certificate, HTTPS listener with HTTP redirect, AWS WAF |
| API | Request validation and throttling, no authorisation | IAM, Cognito or Lambda authoriser |
| EKS | Public API endpoint restricted to admin principals (Access Entries) | Private endpoint |
| Encryption | AWS-managed keys | Customer-managed KMS keys where policy requires them |
| Operations | Logs, VPC Flow Logs, dead-letter queue | CloudWatch alarms on DLQ depth, errors and latency; backups |
