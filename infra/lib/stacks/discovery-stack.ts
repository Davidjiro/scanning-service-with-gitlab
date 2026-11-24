/**
 * STACK: DiscoveryStack  (naming + service-to-service connectivity)
 * ---------------------------------------------------------------------------
 * Depends on NetworkStack (VPCs) and ComputeStack (the internal ALB).
 * It is last because it only makes sense once there is something to point at.
 *
 *   1. Route 53 private hosted zone  "<env>.orderflow.internal"   (associated with ALL THREE VPCs)
 *        internal.<env>.orderflow.internal  ->  ALIAS  internal ALB
 *
 *   2. VPC Lattice service network   (associated with the APP and EKS VPCs)
 *        service "internal" -> target group (ALB) -> the same internal ALB
 *
 * THREE PATHS TO THE SAME INTERNAL ALB
 *
 *   Caller                   Name used                                  Path taken
 *   ───────────────────────  ─────────────────────────────────────────  ──────────────────────────
 *   EKS pod                  http://internal.dev.orderflow.internal           VPC PEERING
 *   Client VPC test box      http://internal.dev.orderflow.internal           TRANSIT GATEWAY
 *   EKS pod                  http://<lattice-dns-name>                  VPC LATTICE (no routes)
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { PrivateHostedZone } from '../constructs/private-hosted-zone';
import { LatticeNetwork } from '../constructs/lattice-network';
import { NetworkStack } from './network-stack';
import { ComputeStack } from './compute-stack';
import { EnvironmentConfig, resourceName } from '../config/environments';
import { privateZoneConfig } from '../config/network.config';
import { ALB_LISTENER_PORT } from '../config/compute.config';

export interface DiscoveryStackProps extends cdk.StackProps {
  readonly envConfig: EnvironmentConfig;
  readonly network: NetworkStack;
  readonly compute: ComputeStack;
}

export class DiscoveryStack extends cdk.Stack {
  public readonly zone: PrivateHostedZone;
  public readonly lattice: LatticeNetwork;

  constructor(scope: Construct, id: string, props: DiscoveryStackProps) {
    super(scope, id, props);
    const { envConfig, network, compute } = props;

    // ---- 1) Route 53 private zone shared by all VPCs.
    this.zone = new PrivateHostedZone(this, 'PrivateZone', {
      ...privateZoneConfig(envConfig),
      vpcs: [network.appVpc.vpc, network.eksVpc.vpc, network.clientVpc.vpc],
    });
    this.zone.addAliasToAlb('internal', compute.internalService.loadBalancer);

    // ---- 2) VPC Lattice: EKS pods (and App VPC callers) reach the internal service without any routing.
    this.lattice = new LatticeNetwork(this, 'Lattice', {
      name: resourceName(envConfig, 'network'),
      serviceName: resourceName(envConfig, 'internal'),
      clientVpcs: [network.appVpc.vpc, network.eksVpc.vpc],
      targetVpc: network.appVpc.vpc,
      targetAlb: compute.internalService.loadBalancer,
      targetAlbSecurityGroup: compute.internalService.albSecurityGroup,
      port: ALB_LISTENER_PORT, // the ALB LISTENER port, not the container port
    });

    new cdk.CfnOutput(this, 'InternalDnsName', {
      value: `internal.${this.zone.zone.zoneName}`,
      description: 'Private DNS name: resolves only inside the three VPCs',
    });
    new cdk.CfnOutput(this, 'LatticeServiceUrl', {
      value: `http://${this.lattice.serviceDnsName}`,
      description: 'Call this from an EKS pod to prove VPC Lattice works',
    });
  }
}
