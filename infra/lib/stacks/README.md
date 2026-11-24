# lib/stacks/  -  six stacks, one job each

A **stack** is a CloudFormation deployment unit. We split by *rate of change* and *blast radius*.

| Stack (deployed name) | Contains | Depends on |
|-----------------------|----------|------------|
| `NetworkStack` (`orderflow-<env>-network`) | 3 VPCs: app, eks, client | - |
| `DataStack` (`orderflow-<env>-data`) | DynamoDB, S3, SQS + DLQ, SNS | - |
| `ConnectivityStack` (`orderflow-<env>-connectivity`) | VPC peering (app<->eks), Transit Gateway (app<->client), client test box | Network |
| `EksStack` (`orderflow-<env>-eks`) | EKS cluster + nodes in the EKS VPC | Network |
| `ComputeStack` (`orderflow-<env>-compute`) | Lambdas, API Gateway, Step Functions, 2 ECS services + ALBs | Network, Data |
| `DiscoveryStack` (`orderflow-<env>-discovery`) | Route 53 private zone + records, VPC Lattice | Network, Compute |
| `GitlabAccessStack` (`orderflow-<env>-gitlab-access`) | IAM OIDC provider + the role GitLab CI assumes | - (account must be CDK-bootstrapped) |

```
Network ──┬──► Connectivity
          ├──► Eks
          └──► Compute ──► Discovery
Data ─────────────┘
```

`GitlabAccessStack` is **not** part of `AppStage`: the identity the pipeline uses must outlive the application it
deploys, and it must exist before the first pipeline run. A human deploys it once per account (root README, section 7).

## How dependencies work
A stack receives other stacks as props (`network: NetworkStack`) and uses their public fields
(`network.appVpc.vpc`). CDK detects the cross-stack reference, creates a CloudFormation Export/Import, and
orders deployment. You never write `addDependency` for these.

## Avoiding circular dependencies
`DiscoveryStack` must allow VPC Lattice into the internal ALB's security group, but that SG belongs to
`ComputeStack`. Calling `sg.addIngressRule()` would put the rule in Compute and make Compute depend on
Discovery => cycle. We create a standalone `CfnSecurityGroupIngress` **inside Discovery** instead
(see `constructs/lattice-network.ts`).

## Why Data is separate from Compute
Stateful resources change rarely and hurt when deleted. Compute changes on every deploy. Separating them
limits risk and allows `terminationProtection` on Data in prod.
