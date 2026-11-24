/**
 * STACK: EksStack
 * ---------------------------------------------------------------------------
 * The Kubernetes cluster, deliberately in its OWN VPC (separate from the app VPC).
 * Depends only on NetworkStack. It is deployed in parallel with the ComputeStack.
 *
 * WHY A SEPARATE VPC FOR EKS?
 *   - Pods consume huge numbers of IPs (one VPC IP per pod) so EKS VPCs need big subnets
 *   - Separate blast radius, separate NAT/egress policy, separate ownership (platform team)
 *   - The cluster reaches the application tier only through explicit links: VPC peering and VPC Lattice
 *
 * The workloads are NOT deployed by CDK. You apply `apps/eks/deployment.yaml` with kubectl
 * (the outputs below print the exact commands). This keeps the stack simple and teaches kubectl.
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { EksCluster } from '../constructs/eks-cluster';
import { NetworkStack } from './network-stack';
import { EnvironmentConfig } from '../config/environments';
import { eksConfig } from '../config/eks.config';

export interface EksStackProps extends cdk.StackProps {
  readonly envConfig: EnvironmentConfig;
  readonly network: NetworkStack;
}

export class EksStack extends cdk.Stack {
  public readonly eks: EksCluster;

  constructor(scope: Construct, id: string, props: EksStackProps) {
    super(scope, id, props);
    const { envConfig, network } = props;

    const config = eksConfig(envConfig);
    if (config.adminRoleArns.length === 0) {
      cdk.Annotations.of(this).addWarning(
        'EKS_ADMIN_ARNS is empty: nobody except the CloudFormation role can use kubectl. See README.',
      );
    }

    this.eks = new EksCluster(this, 'Eks', { ...config, vpc: network.eksVpc.vpc });

    new cdk.CfnOutput(this, 'ClusterName', { value: this.eks.cluster.clusterName });
    new cdk.CfnOutput(this, 'UpdateKubeconfigCommand', {
      value: `aws eks update-kubeconfig --name ${this.eks.cluster.clusterName} --region ${this.region}`,
      description: 'Run this to point kubectl at the cluster',
    });
  }
}
