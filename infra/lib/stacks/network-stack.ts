/**
 * STACK: NetworkStack
 * ---------------------------------------------------------------------------
 * Creates the THREE VPCs for one environment. Nothing else lives here; connections
 * between the VPCs are made in ConnectivityStack so each stack has ONE job.
 *
 *   app    VPC  : ALBs, ECS, Lambdas          (10.<n>0.0.0/16)
 *   eks    VPC  : Kubernetes cluster          (10.<n>1.0.0/16)  <- separate VPC => needs peering
 *   client VPC  : simulated on-prem network   (172.<16+n>.0.0/16)
 *
 * Other stacks receive `appVpc`, `eksVpc`, `clientVpc` as constructor props.
 * CDK turns those object references into CloudFormation exports/imports and
 * automatically orders the deployments (a "stack dependency").
 */
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { VpcNetwork } from '../constructs/vpc-network';
import { EnvironmentConfig } from '../config/environments';
import { vpcConfigs } from '../config/network.config';

export interface NetworkStackProps extends cdk.StackProps {
  readonly envConfig: EnvironmentConfig;
}

export class NetworkStack extends cdk.Stack {
  public readonly appVpc: VpcNetwork;
  public readonly eksVpc: VpcNetwork;
  public readonly clientVpc: VpcNetwork;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const cfg = vpcConfigs(props.envConfig);
    this.appVpc = new VpcNetwork(this, 'AppVpc', cfg.app);
    this.eksVpc = new VpcNetwork(this, 'EksVpc', cfg.eks);
    this.clientVpc = new VpcNetwork(this, 'ClientVpc', cfg.client);

    // Handy outputs: after deploy, `aws cloudformation describe-stacks` shows them.
    new cdk.CfnOutput(this, 'AppVpcId', { value: this.appVpc.vpc.vpcId });
    new cdk.CfnOutput(this, 'EksVpcId', { value: this.eksVpc.vpc.vpcId });
    new cdk.CfnOutput(this, 'ClientVpcId', { value: this.clientVpc.vpc.vpcId });
  }

  /** Convenience for other stacks. */
  public get vpcs(): ec2.IVpc[] {
    return [this.appVpc.vpc, this.eksVpc.vpc, this.clientVpc.vpc];
  }
}
