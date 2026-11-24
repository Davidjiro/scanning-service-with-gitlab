/**
 * PROPS: COMPUTE (Lambda, API Gateway, Step Functions, ECS/ALB, EKS, VPC Lattice)
 */
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';

// ---------------------------------------------------------------- Lambda
export interface PythonLambdaProps {
  readonly functionName: string;
  /** Folder (relative to the infra/ dir) that contains the python source. */
  readonly codePath: string;
  /** e.g. "handler.main"  =>  file handler.py, function main(event, context) */
  readonly handler: string;
  readonly memorySize: number;
  readonly timeout: cdk.Duration;
  readonly environment: Record<string, string>;
  readonly logRetentionDays: number;
  /** Optional: run inside a VPC (needed to reach private resources). */
  readonly vpc?: ec2.IVpc;
  readonly vpcSubnets?: ec2.SubnetSelection;
  readonly securityGroups?: ec2.ISecurityGroup[];
}

// ----------------------------------------------------------- API Gateway
export interface LambdaRestApiProps {
  readonly apiName: string;
  readonly stageName: string;
  readonly handler: lambda.IFunction;
  /** Steady-state requests per second allowed for the whole stage. */
  readonly throttleRateLimit: number;
  readonly throttleBurstLimit: number;
}

// -------------------------------------------------------- Step Functions
export interface OrderStateMachineProps {
  readonly stateMachineName: string;
  readonly validateFunction: lambda.IFunction;
  readonly table: dynamodb.ITable;
  readonly receiptsBucket: s3.IBucket;
  readonly topic: sns.ITopic;
  readonly logRetentionDays: number;
}

// ----------------------------------------------------------- ECS + ALB
export interface FargateAlbServiceProps {
  readonly serviceName: string;
  readonly vpc: ec2.IVpc;
  /** Docker build context folder (relative to infra/). Built and pushed to ECR by CDK. */
  readonly dockerContextPath: string;
  readonly containerPort: number;
  readonly cpu: number;
  readonly memoryMiB: number;
  readonly desiredCount: number;
  /** true  = ALB in PUBLIC subnets with a public IP (internet-facing).
   *  false = ALB in PRIVATE subnets with only private IPs (internal). */
  readonly internetFacing: boolean;
  readonly healthCheckPath: string;
  readonly environment: Record<string, string>;
  /** CIDRs allowed to call an INTERNAL ALB on port 80 (peered VPC, TGW-connected VPC, ...). */
  readonly allowedIngressCidrs: string[];
  readonly logRetentionDays: number;
  /** Task role permissions are added after creation via `service.taskRole`. */
}

// ----------------------------------------------------------------- EKS
export interface EksClusterProps {
  readonly clusterName: string;
  readonly vpc: ec2.IVpc;
  readonly version: eks.KubernetesVersion;
  readonly nodeInstanceType: ec2.InstanceType;
  readonly nodeCount: number;
  /** Kubernetes Service virtual IPs live here (cluster-internal, never on the VPC). */
  readonly serviceCidr: string;
  /** IAM role ARNs that get cluster-admin through EKS Access Entries. */
  readonly adminRoleArns: string[];
}

// ------------------------------------------------------------- Lattice
export interface LatticeNetworkProps {
  readonly name: string;
  /** VPCs that may CALL services in this service network (client side). */
  readonly clientVpcs: ec2.IVpc[];
  /** VPC that owns the target ALB (needed for the target group). */
  readonly targetVpc: ec2.IVpc;
  readonly serviceName: string;
  /** The INTERNAL ALB that Lattice forwards to. */
  readonly targetAlb: elbv2.IApplicationLoadBalancer;
  readonly targetAlbSecurityGroup: ec2.ISecurityGroup;
  readonly port: number;
}
