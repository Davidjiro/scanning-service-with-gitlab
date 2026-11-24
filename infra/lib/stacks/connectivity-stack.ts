/**
 * STACK: ConnectivityStack
 * ---------------------------------------------------------------------------
 * Joins the VPCs together. Depends on NetworkStack (needs the VPCs to exist).
 *
 *   App VPC  <==== VPC PEERING ====>  EKS VPC       (1:1, non-transitive)
 *   App VPC  <==== TRANSIT GATEWAY ==> Client VPC   (hub and spoke, hybrid / on-prem style)
 *
 * NOTE what is NOT connected: the EKS VPC and the Client VPC cannot talk to each other.
 *   - Peering is non-transitive (Client cannot hop App -> EKS).
 *   - The EKS VPC is not attached to the TGW.
 * This is deliberate: transit stays explicit. To allow it, attach the EKS VPC to the TGW as well.
 */
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { VpcPeering } from '../constructs/vpc-peering';
import { TransitGatewayHub } from '../constructs/transit-gateway-hub';
import { ClientHost } from '../constructs/client-host';
import { NetworkStack } from './network-stack';
import { EnvironmentConfig, resourceName } from '../config/environments';
import { TRANSIT_GATEWAY_ASN } from '../config/network.config';

export interface ConnectivityStackProps extends cdk.StackProps {
  readonly envConfig: EnvironmentConfig;
  readonly network: NetworkStack;
}

export class ConnectivityStack extends cdk.Stack {
  public readonly peering: VpcPeering;
  public readonly hub: TransitGatewayHub;
  public readonly clientHost: ClientHost;

  constructor(scope: Construct, id: string, props: ConnectivityStackProps) {
    super(scope, id, props);
    const { network, envConfig } = props;

    // ---- 1) Peering: App <-> EKS. Routes go on the PRIVATE subnets (where the workloads live).
    this.peering = new VpcPeering(this, 'AppToEksPeering', {
      name: resourceName(envConfig, 'app-to-eks'),
      requester: { vpc: network.appVpc.vpc, routeSubnets: network.appVpc.privateSubnets },
      accepter: { vpc: network.eksVpc.vpc, routeSubnets: network.eksVpc.privateSubnets },
    });

    // ---- 2) Transit Gateway: App <-> Client ("on-prem").
    this.hub = new TransitGatewayHub(this, 'Tgw', {
      name: resourceName(envConfig, 'tgw'),
      amazonSideAsn: TRANSIT_GATEWAY_ASN,
      attachments: [
        {
          name: 'app',
          vpc: network.appVpc.vpc,
          attachSubnets: network.appVpc.privateSubnets, // one ENI per AZ
          routeSubnets: network.appVpc.privateSubnets,
        },
        {
          name: 'client',
          vpc: network.clientVpc.vpc,
          attachSubnets: network.clientVpc.publicSubnets,
          routeSubnets: network.clientVpc.publicSubnets,
        },
      ],
    });

    // ---- 3) A box in the client VPC to prove it works.
    this.clientHost = new ClientHost(this, 'ClientHost', {
      vpc: network.clientVpc.vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
    });
    // The instance must not start before routes exist, otherwise early curl tests fail.
    this.clientHost.node.addDependency(this.hub);

    new cdk.CfnOutput(this, 'ClientHostInstanceId', {
      value: this.clientHost.instance.instanceId,
      description: 'Start a shell: aws ssm start-session --target <this id>',
    });
    new cdk.CfnOutput(this, 'TransitGatewayId', { value: this.hub.transitGateway.ref });
    new cdk.CfnOutput(this, 'PeeringConnectionId', { value: this.peering.connection.ref });
  }
}
