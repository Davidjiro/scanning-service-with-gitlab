/**
 * CONSTRUCT (L3): TransitGatewayHub
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   1. A Transit Gateway (TGW): a regional, managed "cloud router"
 *   2. One VPC attachment per VPC (an ENI placed in one subnet per AZ)
 *   3. Routes in each VPC's route tables pointing at the TGW for every OTHER VPC's CIDR
 *
 * HUB AND SPOKE
 *                +-------------+
 *   App VPC ---> |     TGW     | <--- Client VPC (the "on-prem" site)
 *                +-------------+
 *                       ^
 *            (later: VPN / Direct Connect, other VPCs, other accounts via RAM sharing)
 *
 * TWO ROUTING LAYERS (very commonly asked)
 *   (a) VPC route table:  "10.x/16 -> tgw-123"   (gets the packet TO the TGW)   <- we add these
 *   (b) TGW route table:  "which attachment owns which CIDR" (gets it to the right VPC)
 *       With default association + propagation = "enable" the TGW learns each attached
 *       VPC's CIDR automatically, so we do not write (b) by hand. Larger companies disable
 *       the defaults and use several TGW route tables to isolate prod from dev.
 *
 * TGW vs PEERING
 *   Peering: free to create, pay for data only, non-transitive, N*(N-1)/2 connections for a mesh.
 *   TGW:     ~$0.05/hour per attachment + data, TRANSITIVE, one attachment per VPC, supports
 *            VPN/DX, route-table segmentation, multicast, inter-region peering.
 *
 * DEPENDENCY CHAIN
 *   TGW -> attachments -> routes. A route to a TGW fails if the attachment is not "available"
 *   yet, so each route has an explicit dependency on BOTH attachments.
 */
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { TransitGatewayHubProps } from '../props/network-props';

export class TransitGatewayHub extends Construct {
  public readonly transitGateway: ec2.CfnTransitGateway;
  public readonly attachments: ec2.CfnTransitGatewayAttachment[] = [];

  constructor(scope: Construct, id: string, props: TransitGatewayHubProps) {
    super(scope, id);

    this.transitGateway = new ec2.CfnTransitGateway(this, 'Tgw', {
      amazonSideAsn: props.amazonSideAsn,
      description: `${props.name} transit gateway`,
      defaultRouteTableAssociation: 'enable', // new attachments join the default TGW route table
      defaultRouteTablePropagation: 'enable', // ...and advertise their CIDR into it
      autoAcceptSharedAttachments: 'disable', // cross-account attachments need explicit approval
      dnsSupport: 'enable',
      vpnEcmpSupport: 'enable',
      tags: [{ key: 'Name', value: props.name }],
    });

    // 1) Attach every VPC.
    props.attachments.forEach((a) => {
      const attachment = new ec2.CfnTransitGatewayAttachment(this, `Attach-${a.name}`, {
        transitGatewayId: this.transitGateway.ref,
        vpcId: a.vpc.vpcId,
        subnetIds: a.attachSubnets.map((s) => s.subnetId),
        tags: [{ key: 'Name', value: `${props.name}-${a.name}` }],
      });
      this.attachments.push(attachment);
    });

    // 2) In each VPC, send traffic for every OTHER VPC's CIDR to the TGW.
    props.attachments.forEach((from, fromIdx) => {
      props.attachments.forEach((to, toIdx) => {
        if (fromIdx === toIdx) return;
        from.routeSubnets.forEach((subnet, subnetIdx) => {
          const route = new ec2.CfnRoute(this, `Route-${from.name}-to-${to.name}-${subnetIdx}`, {
            routeTableId: subnet.routeTable.routeTableId,
            destinationCidrBlock: to.vpc.vpcCidrBlock,
            transitGatewayId: this.transitGateway.ref,
          });
          route.addResourceDependency(this.attachments[fromIdx]);
          route.addResourceDependency(this.attachments[toIdx]);
        });
      });
    });
  }
}
