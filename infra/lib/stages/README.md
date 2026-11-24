# lib/stages/  -  one complete environment

`app-stage.ts` defines **`AppStage`**: a CDK `Stage` that instantiates all six stacks for ONE environment
(`EnvironmentConfig`) in ONE account.

```
AppStage("dev")  -> account CDK_DEV_ACCOUNT   -> orderflow-dev-network, orderflow-dev-data, ...
AppStage("qa")   -> account CDK_QA_ACCOUNT    -> orderflow-qa-network,  orderflow-qa-data,  ...
AppStage("prod") -> account CDK_PROD_ACCOUNT  -> orderflow-prod-network, ...
```

This is **where the stacks are joined**: the order of the `new XStack(...)` calls and the objects passed between
them define the dependency graph (diagram in the file header).

Used by:
- `bin/app.ts` in direct mode (`cdk deploy "dev/*"`) from your laptop
- `.gitlab-ci.yml`, through `cdk deploy "<env>/*" -c stage=<env>` (which runs `bin/app.ts`)

Same class for both => "what I tested is what gets promoted".

It also adds tags (`Project`, `Environment`, `ManagedBy`) to every resource for cost allocation.
