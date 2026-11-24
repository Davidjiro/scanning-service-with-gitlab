/**
 * STAGE: AppStage  - "all the stacks joined together" for ONE environment
 * ---------------------------------------------------------------------------
 * A CDK `Stage` is a deployable unit that contains stacks. We instantiate it once per
 * environment (dev, qa, prod) and each instance targets a different AWS account:
 *
 *      AppStage("dev")  ─► account CDK_DEV_ACCOUNT
 *      AppStage("qa")   ─► account CDK_QA_ACCOUNT
 *      AppStage("prod") ─► account CDK_PROD_ACCOUNT
 *
 * The SAME code produces all three; only `EnvironmentConfig` differs. That is how you guarantee
 * that what you tested in QA is what reaches prod.
 *
 * It is used in two ways (see bin/app.ts):
 *   - DIRECT deploy from your laptop:   cdk deploy "dev/*"
 *   - GitLab CI deploy:                 .gitlab-ci.yml runs `cdk deploy "<env>/*" -c stage=<env>`
 *
 * DEPENDENCY GRAPH (arrows = "must be deployed before"). CDK derives it from the props we pass.
 *
 *            ┌────────────► ConnectivityStack  (peering + TGW + client box)
 *   Network ─┼────────────► EksStack
 *            ├──► Compute ─► Discovery  (Route 53 + Lattice)
 *   Data ────┘
 *
 *   Network and Data have no dependency on each other, so CloudFormation deploys them in parallel.
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkStack } from '../stacks/network-stack';
import { ConnectivityStack } from '../stacks/connectivity-stack';
import { DataStack } from '../stacks/data-stack';
import { ComputeStack } from '../stacks/compute-stack';
import { EksStack } from '../stacks/eks-stack';
import { DiscoveryStack } from '../stacks/discovery-stack';
import { EnvironmentConfig, PROJECT, resourceName } from '../config/environments';

export interface AppStageProps extends cdk.StageProps {
  readonly envConfig: EnvironmentConfig;
}

export class AppStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props: AppStageProps) {
    const { envConfig } = props;
    super(scope, id, {
      ...props,
      // The target account/region for every stack inside this stage.
      env: { account: envConfig.account, region: envConfig.region },
    });

    // Every stack gets the same env + a readable, collision-free name: orderflow-dev-network, ...
    const stackProps = (suffix: string): cdk.StackProps => ({
      stackName: resourceName(envConfig, suffix),
      description: `${PROJECT} ${envConfig.name}: ${suffix}`,
    });

    const network = new NetworkStack(this, 'Network', { ...stackProps('network'), envConfig });
    const data = new DataStack(this, 'Data', { ...stackProps('data'), envConfig });

    new ConnectivityStack(this, 'Connectivity', { ...stackProps('connectivity'), envConfig, network });
    new EksStack(this, 'Eks', { ...stackProps('eks'), envConfig, network });

    const compute = new ComputeStack(this, 'Compute', { ...stackProps('compute'), envConfig, network, data });
    new DiscoveryStack(this, 'Discovery', { ...stackProps('discovery'), envConfig, network, compute });

    // Tags propagate to every taggable resource: essential for cost allocation by environment.
    cdk.Tags.of(this).add('Project', PROJECT);
    cdk.Tags.of(this).add('Environment', envConfig.name);
    cdk.Tags.of(this).add('ManagedBy', 'cdk');
  }
}
