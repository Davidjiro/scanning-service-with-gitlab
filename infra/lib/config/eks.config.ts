/**
 * CONFIG: EKS  ->  fills `EksClusterProps` (the VPC is added by the stack)
 */
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import { EnvironmentConfig, resourceName } from './environments';
import { EksClusterProps } from '../props/compute-props';

/**
 * IAM principals that get cluster-admin. Set before deploying, comma separated:
 *   export EKS_ADMIN_ARNS="arn:aws:iam::123456789012:user/me"
 * For IAM Identity Center (SSO) use the ROLE arn WITHOUT the /aws-reserved/ path problem:
 *   arn:aws:iam::123456789012:role/aws-reserved/sso.amazonaws.com/AWSReservedSSO_Admin_abcdef
 * (see root README, section "Give yourself EKS access").
 */
function adminArns(): string[] {
  return (process.env.EKS_ADMIN_ARNS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function eksConfig(env: EnvironmentConfig): Omit<EksClusterProps, 'vpc'> {
  return {
    clusterName: resourceName(env, 'eks'),
    // Check the supported versions with: aws eks describe-cluster-versions
    version: eks.KubernetesVersion.V1_35,
    nodeInstanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
    nodeCount: env.isProd ? 3 : 2,
    // Cluster-internal Service IPs. Reserved in the CIDR plan: must not overlap any VPC we connect.
    serviceCidr: '172.20.0.0/16',
    adminRoleArns: adminArns(),
  };
}
