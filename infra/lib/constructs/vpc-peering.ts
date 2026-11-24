/**
 * CONSTRUCT (L3): VpcPeering
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   1. A VPC peering connection between two VPCs (same account + region here)
 *   2. A route in EVERY relevant route table on BOTH sides
 *
 * THE #1 PEERING MISTAKE: creating the peering connection and forgetting the routes.
 * A peering connection is only a "pipe". Packets only use it if a route table says
 *      "to reach 10.10.0.0/16, send to pcx-123".
 * You need that route on BOTH sides, otherwise requests arrive but replies are lost.
 *
 * PEERING RULES
 *   - CIDRs must NOT overlap (that is why we planned the CIDRs in config/environments.ts).
 *   - Peering is NON-TRANSITIVE: if A<->B and B<->C, then A cannot reach C through B.
 *     (Transit Gateway fixes that. Compare with transit-gateway-hub.ts.)
 *   - Security groups must also allow the traffic (we allow the peer CIDR on the ALB's SG).
 *   - Works across accounts and regions (cross-account needs an accept step).
 *   - No bandwidth bottleneck and no single point of failure: it uses the AWS backbone.
 *
 * DEPENDENCY CHAIN
 *   VPC A + VPC B  ->  peering connection  ->  routes (each route depends on the connection)
 */
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { VpcPeeringProps, PeeringSideProps } from '../props/network-props';

export class VpcPeering extends Construct {
  public readonly connection: ec2.CfnVPCPeeringConnection;

  constructor(scope: Construct, id: string, props: VpcPeeringProps) {
    super(scope, id);

    // Same-account / same-region peering is auto-accepted. Cross-account would need
    // `peerOwnerId` + `peerRoleArn` and an accepter in the other account.
    this.connection = new ec2.CfnVPCPeeringConnection(this, 'Connection', {
      vpcId: props.requester.vpc.vpcId,
      peerVpcId: props.accepter.vpc.vpcId,
      tags: [{ key: 'Name', value: props.name }],
    });

    this.addRoutes('ReqToAcc', props.requester, props.accepter);
    this.addRoutes('AccToReq', props.accepter, props.requester);
  }

  /** For each subnet on `from`, route traffic destined for `to`'s CIDR through the peering. */
  private addRoutes(prefix: string, from: PeeringSideProps, to: PeeringSideProps): void {
    from.routeSubnets.forEach((subnet, index) => {
      const route = new ec2.CfnRoute(this, `${prefix}Route${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: to.vpc.vpcCidrBlock,
        vpcPeeringConnectionId: this.connection.ref,
      });
      route.addResourceDependency(this.connection);
    });
  }
}
