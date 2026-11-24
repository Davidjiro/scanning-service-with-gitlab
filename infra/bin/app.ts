#!/usr/bin/env node
/**
 * APP ENTRY POINT  -  where everything is joined together
 * ---------------------------------------------------------------------------
 * `cdk` runs this file (see "app" in cdk.json). Two modes, chosen with a context flag:
 *
 *  1) DIRECT mode (default). Deploys ONE environment of the application. This is exactly what the
 *     GitLab pipeline runs, and what you run from a workstation during development.
 *        npx cdk deploy "dev/*"                       # stage defaults to dev
 *        npx cdk deploy "qa/*" -c stage=qa
 *
 *  2) GITLAB-ACCESS mode. Deploys the small, one-time stack that lets GitLab CI assume an IAM role in
 *     an account (OIDC trust). Run once per account, by a human, before the first pipeline.
 *        npx cdk deploy orderflow-dev-gitlab-access -c mode=gitlab-access -c stage=dev
 *
 * The pipeline itself is NOT code in this app: it is `.gitlab-ci.yml` at the repository root. It calls
 * mode 1 for each environment, so the code you test directly is exactly the code GitLab promotes.
 */
import * as cdk from 'aws-cdk-lib';
import { AppStage } from '../lib/stages/app-stage';
import { GitlabAccessStack } from '../lib/stacks/gitlab-access-stack';
import { ENVIRONMENTS, EnvName, resourceName } from '../lib/config/environments';

const app = new cdk.App();

/**
 * WHY THIS BLOCK EXISTS (offline, deterministic synthesis)
 * ec2.Vpc always asks the stack for its list of Availability Zones. For a stack with an explicit
 * account + region, CDK normally answers by calling EC2 DescribeAvailabilityZones through a "lookup
 * role" in that account. We avoid that by pre-filling CDK's context cache from our own config (same
 * key format as `cdk.context.json`). Result: `cdk synth` makes NO AWS calls, so the GitLab "validate"
 * job can synthesise without any credentials.
 */
Object.values(ENVIRONMENTS).forEach((env) => {
  if (env.account) {
    app.node.setContext(`availability-zones:account=${env.account}:region=${env.region}`, env.availabilityZones);
  }
});

const mode = (app.node.tryGetContext('mode') as string | undefined) ?? 'direct';
const stageName = ((app.node.tryGetContext('stage') as string | undefined) ?? 'dev') as EnvName;
const envConfig = ENVIRONMENTS[stageName];
if (!envConfig) {
  throw new Error(`Unknown stage "${stageName}". Use one of: ${Object.keys(ENVIRONMENTS).join(', ')}`);
}

if (mode === 'gitlab-access') {
  new GitlabAccessStack(app, resourceName(envConfig, 'gitlab-access'), {
    env: { account: envConfig.account, region: envConfig.region },
    description: `CI/CD identity: lets GitLab CI deploy to ${envConfig.name} (OIDC, no stored keys)`,
    envConfig,
  });
} else {
  new AppStage(app, stageName, { envConfig });
}

app.synth();
