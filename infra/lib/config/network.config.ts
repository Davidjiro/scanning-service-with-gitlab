/**
 * CONFIG: NETWORK  ->  fills the props in `props/network-props.ts`
 */
import { VpcNetworkProps, PrivateHostedZoneProps } from '../props/network-props';
import { EnvironmentConfig } from './environments';

/**
 * SUBNET MATH for a 10.10.0.0/16 VPC with 2 AZs (CDK allocates left to right, in the
 * order the tiers are declared inside VpcNetwork):
 *
 *   tier       AZ-a            AZ-b
 *   public     10.10.0.0/24    10.10.1.0/24
 *   private    10.10.2.0/24    10.10.3.0/24
 *   isolated   10.10.4.0/24    10.10.5.0/24
 *   free       10.10.6.0 -> 10.10.255.255   (room to grow: never fill a VPC on day one)
 *
 * The EKS VPC (10.11.0.0/16) uses a BIGGER private tier (/20 = 4,091 usable IPs per AZ): public
 * 10.11.0.0/24 + 10.11.1.0/24, private 10.11.16.0/20 + 10.11.32.0/20 (a /20 must start on a /20
 * boundary, so CDK skips ahead to 10.11.16.0). With
 * the AWS VPC CNI every POD takes a real VPC IP address. Small subnets = pod scheduling fails.
 */
export function vpcConfigs(env: EnvironmentConfig): {
  app: VpcNetworkProps;
  eks: VpcNetworkProps;
  client: VpcNetworkProps;
} {
  return {
    app: {
      name: 'app',
      cidr: env.cidrs.app,
      availabilityZones: env.availabilityZones,
      natGateways: env.natGateways,
      subnets: { publicCidrMask: 24, privateCidrMask: 24, isolatedCidrMask: 24 },
      enableGatewayEndpoints: true,
      enableFlowLogs: env.isProd,
    },
    eks: {
      name: 'eks',
      cidr: env.cidrs.eks,
      availabilityZones: env.availabilityZones,
      natGateways: env.natGateways,
      subnets: { publicCidrMask: 24, privateCidrMask: 20, isolatedCidrMask: 0 },
      enableGatewayEndpoints: true,
      enableFlowLogs: false,
    },
    client: {
      name: 'client',
      cidr: env.cidrs.client,
      availabilityZones: env.availabilityZones,
      natGateways: 0, // the test box sits in a public subnet, so no NAT is needed
      subnets: { publicCidrMask: 24, privateCidrMask: 0, isolatedCidrMask: 0 },
      enableGatewayEndpoints: false,
      enableFlowLogs: false,
    },
  };
}

/** Private Route 53 zone: resolves only inside the VPCs we attach. Not a real public domain. */
export function privateZoneConfig(env: EnvironmentConfig): Pick<PrivateHostedZoneProps, 'zoneName'> {
  return { zoneName: `${env.name}.orderflow.internal` };
}

/** Transit Gateway settings. 64512-65534 is the private 16-bit ASN range. */
export const TRANSIT_GATEWAY_ASN = 64512;
