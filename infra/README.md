# infra/  -  the CDK app (TypeScript)

Everything that creates AWS resources. Run all commands from this directory.

## Mental model: four layers

```
 config/  ──fills──►  props/  ──input to──►  constructs/  ──assembled by──►  stacks/  ──grouped by──►  stages/
 (values)            (interfaces)           (L3 building blocks)            (deployable units)        (one per environment)
```

| Directory | Question it answers | Rule |
|-----------|---------------------|------|
| `lib/config` | "What VALUES does dev/qa/prod use?" | the only place with CIDRs, sizes, retention |
| `lib/props` | "What does each construct NEED?" | interfaces only, no logic |
| `lib/constructs` | "How do I build one AWS building block well?" | never reads config; only receives props |
| `lib/stacks` | "Which constructs go together and how do they depend on each other?" | passes live objects between stacks |
| `lib/stages` | "What is ONE complete environment?" | `AppStage` joins all stacks |
| `bin/app.ts` | "What do I deploy right now?" | direct mode, or the one-time `gitlab-access` mode |

The pipeline is **not** in this directory: it is `../.gitlab-ci.yml` (see `../ci/README.md`). It calls `cdk deploy` on `AppStage`.

## Files and tools

| File | Purpose |
|------|---------|
| `package.json` / `package-lock.json` | exact dependency versions, including the pinned `aws-cdk` CLI (`npm ci` installs precisely these) |
| `cdk.json` | tells the CDK CLI how to run the app (`ts-node bin/app.ts`) |
| `tsconfig.json` | strict TypeScript settings |

## Everyday commands
```bash
npm ci                          # install
npx tsc --noEmit                # type-check only
npx cdk synth "dev/*" --quiet   # build CloudFormation templates into cdk.out/
npx cdk diff "dev/*"            # preview changes
npx cdk deploy "dev/*"          # deploy
npx cdk destroy "dev/*"         # delete
```

## Why `"dev/*"`?
`AppStage` is a CDK *Stage*, so stack ids are prefixed with the stage id: `dev/Network`, `dev/Compute`...
The glob `"dev/*"` selects all six. Quote it so your shell does not expand it.

## Concepts worth being able to explain
- **L1 / L2 / L3 constructs**: `Cfn*` (1:1 CloudFormation) / opinionated AWS classes (`ec2.Vpc`) / your own patterns (`VpcNetwork`).
- **Asset**: a local file or Docker build context that CDK uploads to the bootstrap S3 bucket / ECR repo.
- **Bootstrap**: one-time per account+region stack that provides the bucket, repo and IAM roles CDK needs.
- **Context**: cached lookup values. We pre-seed Availability Zones in `bin/app.ts` so synth is offline.
- **Cross-stack references**: passing `network.appVpc.vpc` into another stack creates a CloudFormation export/import.
