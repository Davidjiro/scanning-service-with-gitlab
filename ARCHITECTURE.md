# Architecture: OrderFlow (GitLab CI/CD edition)

OrderFlow is an event-driven **order processing** platform. The business logic is deliberately
small; the substance is the **AWS architecture and how its parts connect**.

Everything is defined in TypeScript CDK (`infra/`) and runs small Python services (`apps/`).

---

## 1. The story (what happens to an order)

```
 1. Client  --POST /orders-->  API Gateway --> Lambda "api-handler"
                                                   |-- writes order (status NEW) --> DynamoDB
                                                   '-- publishes "order.created" --> SNS topic
 2. SNS topic --(filter: event_type = order.created)--> SQS queue (+ Dead Letter Queue)
 3. SQS queue --(event source mapping)--> Lambda "worker" --> starts Step Functions state machine
 4. State machine:  Validate (Lambda) --> Choice --valid--> Mark PROCESSED (DynamoDB, direct SDK call)
                                              |                 --> Write receipt (S3, direct SDK call)
                                              |                 --> Publish "order.processed" (SNS)
                                              '--invalid--> Mark REJECTED (DynamoDB) --> Fail
 5. Containers (ECS Fargate + EKS pods) expose /health, /whoami, /orders and /peer-check
```

Why the SNS **filter policy**? The state machine publishes `order.processed` to the *same*
topic. Without the filter, the queue would receive it and re-trigger processing forever.

---

## 2. Accounts and environments

```
 +----------------------------------+
 |  GitLab CI/CD  (.gitlab-ci.yml)  |
 |  arm64 runner + docker:dind      |
 +----------------+-----------------+
                  |
                  |  1) GitLab gives the job a signed OIDC ID token  (claims: aud, sub = project + branch)
                  |  2) job calls  aws sts assume-role-with-web-identity  (token + role ARN)
                  |  3) AWS verifies the token and the role's trust policy, returns credentials (max 2 h)
                  |  4) job runs  cdk deploy  (which assumes the cdk-* bootstrap roles in that account)
                  |
      +-----------+------------------------+------------------------+
      v                                    v                        v
 +----------------+                +----------------+       +----------------+
 |  DEV account   |                |   QA account   |       |  PROD account  |
 |  OIDC provider |                |  OIDC provider |       |  OIDC provider |
 |  orderflow-dev-      |                |  orderflow-qa-       |       |  orderflow-prod-     |
 |  gitlab-deploy |                |  gitlab-deploy |       |  gitlab-deploy |
 +----------------+                +----------------+       +----------------+

 Pipeline:  validate -> DEV (auto) + smoke test -> QA (manual gate) + smoke test -> PROD (manual gate) + health check
 Trust:     dev role = any branch of this project; qa / prod roles = the default branch ONLY (enforced by AWS)
```

Each environment account gets the **same stacks** with **different config** (CIDRs, sizes, retention).
There is no tooling account: GitLab runners live outside AWS and authenticate with OIDC, so no AWS access key is stored anywhere.

---

## 3. Network design (per environment account)

Three VPCs with **non-overlapping CIDRs**. Non-overlap is mandatory for peering and
Transit Gateway, because routes are by destination CIDR.

| Env  | App VPC       | EKS VPC       | Client VPC ("on-prem") |
|------|---------------|---------------|------------------------|
| dev  | 10.10.0.0/16  | 10.11.0.0/16  | 172.16.0.0/16          |
| qa   | 10.20.0.0/16  | 10.21.0.0/16  | 172.17.0.0/16          |
| prod | 10.30.0.0/16  | 10.31.0.0/16  | 172.18.0.0/16          |

Reserved and never used for VPCs: `172.20.0.0/16` (EKS Kubernetes service CIDR) and
`169.254.171.0/24` (VPC Lattice link-local range).

```
                                   INTERNET
                                      |
                         +------------+--------------+
                         |                           |
                   Internet Gateway            API Gateway (regional, managed)
                         |                           |
 +------------------------------- APP VPC 10.10.0.0/16 ---------------------------------+
 |                                                                                        |
 |  PUBLIC subnets (2 AZs)  10.10.0.0/24, 10.10.1.0/24                                     |
 |     [ Public ALB "web" ]            [ NAT Gateway ]   (route 0.0.0.0/0 -> IGW)          |
 |             |                              ^                                           |
 |  PRIVATE subnets (2 AZs) 10.10.2.0/24, 10.10.3.0/24   (route 0.0.0.0/0 -> NAT)          |
 |     [ ECS Fargate "web" tasks ]  [ ECS Fargate "internal" tasks ]  [ Lambdas (VPC) ]   |
 |                 ^                         ^                                            |
 |     [ Internal ALB ] <--- targets ----------'                                          |
 |                                                                                        |
 |  ISOLATED subnets (2 AZs) 10.10.4.0/24, 10.10.5.0/24  (no internet route at all)        |
 |     reserved for databases / future use                                                |
 |  Gateway endpoints (free): S3, DynamoDB  -> traffic stays on the AWS network           |
 +----+------------------------+----------------------------------------------+----------+
      |                        |                                              |
  VPC PEERING             TRANSIT GATEWAY                               VPC LATTICE
      |                        |                                       service network
      v                        v                                              ^
 +----------- EKS VPC ---+  +------ CLIENT VPC 172.16.0.0/16 ------+           |
 | 10.11.0.0/16          |  | simulates a corporate / on-prem site  |           |
 | PRIVATE: EKS nodes    |  | PUBLIC: EC2 test box (SSM, no SSH)    |           |
 |   and pods (/20)      |  +---------------------------------------+           |
 | PUBLIC: NAT + LBs     |                                                      |
 +-----------------------+------------------------------------------------------+
        pods call the internal service through Lattice too (no routing needed)
```

### Four ways to connect networks, and why each exists here

| Mechanism | Used between | Key properties |
|-----------|--------------|----------------|
| **VPC Peering** | App VPC <-> EKS VPC | 1:1, cheap, **non-transitive**, needs non-overlapping CIDRs and routes on **both** sides |
| **Transit Gateway** | App VPC <-> Client VPC | Hub-and-spoke, **transitive**, scales to many VPCs / VPN / Direct Connect |
| **VPC Lattice** | EKS VPC -> internal service | Application-layer (L7), **no routing**, overlapping CIDRs are fine, built-in auth policies |
| **Route 53 private hosted zone** | all three VPCs | One internal name (`internal.<env>.orderflow.internal`) that every VPC resolves |

---

## 4. Security groups (least privilege chain)

```
 Internet --80--> [alb-public-sg] --8080--> [web-service-sg]           (SG-to-SG, not CIDR)
 Peering / TGW / Lattice --80--> [alb-internal-sg] --8080--> [internal-service-sg]
 EKS VPC CIDR 10.11.0.0/16 --80--> alb-internal-sg     (peering path)
 Client VPC CIDR 172.16.0.0/16 --80--> alb-internal-sg (TGW path)
 Lattice managed prefix list --80--> alb-internal-sg   (Lattice path)
```

---

## 5. Stack layout and dependency order

```
 GitlabAccessStack (OIDC provider + deploy role)   <- separate, deployed ONCE per account by a human

 NetworkStack  (3 VPCs, subnets, IGW, NAT, endpoints)
    |-----> ConnectivityStack (VPC peering, Transit Gateway, client test host)
    |-----> DataStack         (DynamoDB, S3, SQS+DLQ, SNS)          [independent of the VPCs]
    |-----> EksStack         (EKS cluster in the EKS VPC)
 ComputeStack  (needs Network + Data):  Lambdas, API Gateway, Step Functions, ECS + ALBs
 DiscoveryStack (needs Network + Compute + Eks): Route 53 private zone records + VPC Lattice
```

Deploy order is automatic because stacks pass objects to each other. CloudFormation
exports and cross-stack references are generated by CDK.

---

## 6. Resource to AWS service map

| Concern | Service | Where in this repo |
|---------|---------|--------------------|
| Networking | VPC, subnets, IGW, NAT, SGs | `constructs/vpc-network.ts` |
| Private connectivity | Peering, TGW | `constructs/vpc-peering.ts`, `constructs/transit-gateway-hub.ts` |
| DNS | Route 53 | `constructs/private-hosted-zone.ts` |
| Service-to-service | VPC Lattice | `constructs/lattice-network.ts` |
| Containers | ECS Fargate + ALB, EKS | `constructs/fargate-alb-service.ts`, `constructs/eks-cluster.ts` |
| Serverless | Lambda, API Gateway | `constructs/python-lambda.ts`, `constructs/lambda-rest-api.ts` |
| Orchestration | Step Functions | `constructs/order-state-machine.ts` |
| Data | DynamoDB, S3 | `constructs/dynamo-table.ts`, `constructs/secure-bucket.ts` |
| Messaging | SQS (+DLQ), SNS | `constructs/queue-with-dlq.ts`, `constructs/event-topic.ts` |
| CI/CD | GitLab CI/CD + OIDC | `.gitlab-ci.yml`, `ci/`, `constructs/gitlab-oidc-role.ts` |

---

## 7. Cost warning

Per environment this runs a NAT gateway, two ALBs, an EKS control plane plus nodes, and two
Transit Gateway attachments. Budget **roughly $8-10 per day**. Deploy `dev` only, test, then
destroy (`cdk destroy`). See the root `README.md`.
