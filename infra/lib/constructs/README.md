# lib/constructs/  -  level-3 constructs

One class per AWS building block. Each file starts with a long comment: **what it builds, key concepts,
what depends on what, and the pitfalls**. The file headers document each design decision.

| File | AWS service(s) | Depends on | Key lesson |
|------|----------------|------------|------------|
| `vpc-network.ts` | VPC, subnets, IGW, NAT, gateway endpoints, flow logs | - | public / private / isolated tiers; what makes a subnet public |
| `vpc-peering.ts` | VPC peering + routes | two VPCs | routes on BOTH sides; non-transitive |
| `transit-gateway-hub.ts` | Transit Gateway + attachments + routes | VPCs | hub and spoke; VPC route table vs TGW route table |
| `private-hosted-zone.ts` | Route 53 private zone, alias records | VPCs, ALB | private vs public zone; alias vs CNAME |
| `client-host.ts` | EC2 + SSM | client VPC | no SSH; Session Manager |
| `dynamo-table.ts` | DynamoDB | - | PK/SK, GSI, on-demand, hot partitions |
| `secure-bucket.ts` | S3 | - | block public access, SSL-only, lifecycle |
| `queue-with-dlq.ts` | SQS | - | visibility timeout, redrive, at-least-once |
| `event-topic.ts` | SNS | queue (for subscription) | fan-out, filter policy, raw delivery |
| `python-lambda.ts` | Lambda | VPC (optional) | cold start, VPC trade-offs, log retention |
| `lambda-rest-api.ts` | API Gateway (REST) | Lambda | proxy integration, validators, throttling, REST vs HTTP API |
| `order-state-machine.ts` | Step Functions | Lambda, table, bucket, topic | Standard vs Express, SDK integrations, retries |
| `fargate-alb-service.ts` | ECS Fargate, ALB, target group, auto scaling | VPC | **target group + health checks**, SG chain, task vs execution role |
| `eks-cluster.ts` | EKS + managed node group + access entries | EKS VPC | control plane vs nodes, pod IPs, access entries |
| `lattice-network.ts` | VPC Lattice | internal ALB, VPCs | L7 service networking vs peering/TGW; managed prefix list requirement |
| `gitlab-oidc-role.ts` | IAM OIDC provider + role | CDK-bootstrapped account | keyless CI auth: ID token, `aud`/`sub` trust conditions, least-privilege deploy role |

## Rules for writing a construct here
1. Extend `Construct`; constructor is `(scope, id, props)` where `props` is an interface from `../props`.
2. Never import from `../config`. Never read `process.env`.
3. Expose the important created resources as `public readonly` fields so stacks can wire them (`grant*`, references).
4. Apply secure defaults (encryption, no public access, least-privilege SGs).
5. Document dependencies and pitfalls in the header comment.
