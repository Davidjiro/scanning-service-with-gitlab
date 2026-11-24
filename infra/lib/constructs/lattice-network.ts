/**
 * CONSTRUCT (L3): LatticeNetwork  (Amazon VPC Lattice)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *
 *   EKS VPC ─┐                                   ┌─ Lattice SERVICE "internal"
 *            ├─ association ─► SERVICE NETWORK ◄─┤        │ listener HTTP:80
 *   App VPC ─┘                                   │        ▼
 *                                                └─ TARGET GROUP (type ALB) ──► internal ALB ──► Fargate tasks
 *
 * WHAT IS VPC LATTICE?
 *   An application-layer (L7) networking service. You publish a SERVICE, put it in a SERVICE NETWORK,
 *   and associate VPCs with that network. Any workload in an associated VPC can call the service by
 *   DNS name. NO peering, NO Transit Gateway, NO route tables, and OVERLAPPING CIDRs ARE FINE.
 *
 * BUILDING BLOCKS (each one is a CloudFormation resource below)
 *   Service network       Logical boundary; the "mesh". Has an optional auth policy (IAM / SigV4).
 *   VPC association       Plugs a VPC (the CLIENT side) into the service network. Can have security groups.
 *   Service               Your application endpoint. Gets an auto-generated DNS name.
 *   Listener              Protocol + port on the service (HTTP:80) and the default action.
 *   Target group          Where traffic goes: instances | IPs | Lambda | ALB. We target the internal ALB,
 *                         so the ALB keeps doing path routing and health checking.
 *   Service association   Adds the service to the service network.
 *
 * LATTICE vs PEERING vs TRANSIT GATEWAY  (classic question)
 *   Peering / TGW connect NETWORKS (L3). Everything in VPC A can then reach everything in VPC B, subject to
 *   security groups, and CIDRs must not overlap.
 *   Lattice connects SERVICES (L7). Clients can reach only the services you publish, with per-service
 *   auth policies, built-in observability, weighted routing, and no CIDR constraints.
 *
 * THE SECURITY-GROUP REQUIREMENT
 *   Lattice sends traffic to targets from addresses in an AWS-MANAGED PREFIX LIST (not from the client's
 *   IP). The target ALB's security group must therefore allow that prefix list. We look up its id with a
 *   small custom resource (`ec2:DescribePrefixLists`) because the id differs per region.
 *   Without this rule: health checks fail and the Lattice service returns 503.
 *
 * DEPENDENCIES
 *   Target ALB must exist. Service network -> VPC associations; Target group -> Listener -> Service
 *   -> Service-network association. CloudFormation orders them through the references below.
 */
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as vpclattice from 'aws-cdk-lib/aws-vpclattice';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { LatticeNetworkProps } from '../props/compute-props';

export class LatticeNetwork extends Construct {
  public readonly serviceNetwork: vpclattice.CfnServiceNetwork;
  public readonly service: vpclattice.CfnService;
  /** DNS name clients use, e.g. internal-0abc.7d67968.vpc-lattice-svcs.us-east-1.on.aws */
  public readonly serviceDnsName: string;

  constructor(scope: Construct, id: string, props: LatticeNetworkProps) {
    super(scope, id);

    // 1) The service network (authType NONE = no IAM auth policy; acceptable for this internal-only service; use AWS_IAM in production).
    this.serviceNetwork = new vpclattice.CfnServiceNetwork(this, 'ServiceNetwork', {
      name: props.name,
      authType: 'NONE',
    });

    // 2) Associate every CLIENT VPC with the service network.
    props.clientVpcs.forEach((vpc, index) => {
      const associationSg = new ec2.SecurityGroup(this, `AssocSg${index}`, {
        vpc,
        description: `Lattice VPC association: who in ${props.name} VPC may call the service network`,
        allowAllOutbound: true,
      });
      // Only workloads INSIDE this VPC may use the service network through this association.
      associationSg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(80), 'HTTP from this VPC');
      associationSg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(443), 'HTTPS from this VPC');

      new vpclattice.CfnServiceNetworkVpcAssociation(this, `VpcAssociation${index}`, {
        serviceNetworkIdentifier: this.serviceNetwork.attrId,
        vpcIdentifier: vpc.vpcId,
        securityGroupIds: [associationSg.securityGroupId],
      });
    });

    // 3) Target group of type ALB pointing at the internal ALB.
    const targetGroup = new vpclattice.CfnTargetGroup(this, 'TargetGroup', {
      name: `${props.serviceName}-tg`,
      type: 'ALB',
      config: {
        port: props.port,
        protocol: 'HTTP',
        protocolVersion: 'HTTP1',
        vpcIdentifier: props.targetVpc.vpcId,
      },
      targets: [{ id: props.targetAlb.loadBalancerArn, port: props.port }],
    });

    // 4) The service, its listener, and its membership in the service network.
    this.service = new vpclattice.CfnService(this, 'Service', {
      name: props.serviceName,
      authType: 'NONE',
    });

    const listener = new vpclattice.CfnListener(this, 'Listener', {
      serviceIdentifier: this.service.attrId,
      protocol: 'HTTP',
      port: props.port,
      defaultAction: {
        forward: { targetGroups: [{ targetGroupIdentifier: targetGroup.attrId, weight: 100 }] },
      },
    });

    const serviceAssociation = new vpclattice.CfnServiceNetworkServiceAssociation(this, 'ServiceAssociation', {
      serviceIdentifier: this.service.attrId,
      serviceNetworkIdentifier: this.serviceNetwork.attrId,
    });
    serviceAssociation.node.addDependency(listener);

    this.serviceDnsName = this.service.attrDnsEntryDomainName;

    // 5) Let Lattice reach the ALB: allow the Lattice managed prefix list on the ALB security group.
    const region = cdk.Stack.of(this).region;
    const lookup = new cr.AwsCustomResource(this, 'LatticePrefixListLookup', {
      onUpdate: {
        service: 'EC2',
        action: 'describePrefixLists',
        parameters: { Filters: [{ Name: 'prefix-list-name', Values: [`com.amazonaws.${region}.vpc-lattice`] }] },
        physicalResourceId: cr.PhysicalResourceId.of(`lattice-prefix-list-${region}`),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });

    // IMPORTANT: a raw CfnSecurityGroupIngress lives in THIS stack. If we used
    // `albSecurityGroup.addIngressRule(...)` the rule would be added to the SG's own (Compute) stack,
    // which would then depend on this stack, while this stack depends on Compute => circular dependency.
    new ec2.CfnSecurityGroupIngress(this, 'AllowLatticeToAlb', {
      groupId: props.targetAlbSecurityGroup.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: props.port,
      toPort: props.port,
      sourcePrefixListId: lookup.getResponseField('PrefixLists.0.PrefixListId'),
      description: 'VPC Lattice managed prefix list',
    });
  }
}
