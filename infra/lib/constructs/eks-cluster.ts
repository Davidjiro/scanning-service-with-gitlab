/**
 * CONSTRUCT (L3): EksCluster  (Amazon Elastic Kubernetes Service)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   - An EKS control plane (managed by AWS, runs in AWS's account, reached through ENIs in YOUR subnets)
 *   - A MANAGED node group of Graviton (ARM64) EC2 instances in the PRIVATE subnets
 *   - Cluster-admin access for the IAM principals you list (EKS Access Entries)
 *
 *   This cluster lives in its OWN VPC (10.<n>1.0.0/16). It reaches the App VPC through
 *   VPC PEERING (see connectivity-stack.ts) and through VPC LATTICE (see lattice-network.ts).
 *
 * EKS VOCABULARY
 *   Control plane     API server + etcd + scheduler. AWS runs and scales it. You pay ~$0.10/hour.
 *   Managed node group  EC2 instances in an Auto Scaling Group that AWS patches/drains for you.
 *   Fargate profile   Alternative: serverless pods (no nodes). Auto Mode: AWS manages nodes entirely.
 *   Pod               Smallest deployable unit. With the AWS VPC CNI each pod gets a REAL VPC IP
 *                     address => subnets must be big (we use /20). Pods can then be reached by peering,
 *                     TGW and security groups exactly like EC2 instances.
 *   Service (K8s)     Stable virtual IP/DNS for a set of pods. Its IPs come from `serviceCidr`
 *                     (172.20.0.0/16), which is cluster-internal and must not clash with your VPCs.
 *   Access Entries    The modern replacement for editing the `aws-auth` ConfigMap. IAM principal
 *                     -> Kubernetes permissions, managed through the EKS API (and thus CloudFormation).
 *   IRSA / Pod Identity  How a POD gets AWS permissions (not shown: our eks-client pods only call HTTP).
 *
 * WHO IS ADMIN?  The IAM identity that CloudFormation uses to create the cluster is NOT you
 * (CDK's CloudFormation execution role). So we explicitly grant `adminRoleArns` (your IAM user or role)
 * cluster-admin, otherwise `kubectl` returns "Unauthorized". See the root README.
 *
 * ENDPOINT ACCESS: PUBLIC_AND_PRIVATE = kubectl works from your laptop AND nodes talk to the API
 * server privately. In production restrict the public CIDRs or go PRIVATE and use a bastion/VPN.
 *
 * DEPENDENCIES: the EKS VPC (+ NAT so nodes can pull images and register).
 */
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks-v2';
import { Construct } from 'constructs';
import { EksClusterProps } from '../props/compute-props';

export class EksCluster extends Construct {
  public readonly cluster: eks.Cluster;
  public readonly nodegroup: eks.Nodegroup;

  constructor(scope: Construct, id: string, props: EksClusterProps) {
    super(scope, id);

    this.cluster = new eks.Cluster(this, 'Cluster', {
      clusterName: props.clusterName,
      version: props.version,
      vpc: props.vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
      serviceIpv4Cidr: props.serviceCidr,
      endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE,
      defaultCapacity: 0, // we add our own node group below, so we control the details
      defaultCapacityType: eks.DefaultCapacityType.NODEGROUP,
    });

    this.nodegroup = this.cluster.addNodegroupCapacity('Nodes', {
      instanceTypes: [props.nodeInstanceType],
      amiType: eks.NodegroupAmiType.AL2023_ARM_64_STANDARD, // must match the ARM (Graviton) instance type
      minSize: props.nodeCount,
      desiredSize: props.nodeCount,
      maxSize: props.nodeCount + 1,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    props.adminRoleArns.forEach((arn, index) => {
      this.cluster.grantAccess(`Admin${index}`, arn, [
        eks.AccessPolicy.fromAccessPolicyName('AmazonEKSClusterAdminPolicy', {
          accessScopeType: eks.AccessScopeType.CLUSTER,
        }),
      ]);
    });
  }
}
