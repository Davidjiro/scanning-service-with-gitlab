/**
 * PROPS: NETWORKING
 * ---------------------------------------------------------------------------
 * A "props" interface is the CONTRACT of a construct: it lists every input the
 * construct needs. Constructs never read config files themselves; they only
 * receive props. The `config/` directory is what FILLS these interfaces with
 * real values per environment.   config  -->  props  -->  construct
 */
import * as ec2 from 'aws-cdk-lib/aws-ec2';

/** How big each tier of subnet is. A /24 = 256 addresses (251 usable; AWS reserves 5). */
export interface SubnetLayoutProps {
  /** Public tier: route to the Internet Gateway. Holds load balancers + NAT gateways. */
  readonly publicCidrMask: number;
  /** Private tier: route to a NAT gateway (egress only). Holds app compute. */
  readonly privateCidrMask: number;
  /** Isolated tier: NO internet route in either direction. Holds databases. 0 = do not create. */
  readonly isolatedCidrMask: number;
}

export interface VpcNetworkProps {
  /** Short name used for tagging and construct naming, e.g. "app", "eks", "client". */
  readonly name: string;
  /** The VPC CIDR block, e.g. "10.10.0.0/16". Must not overlap any VPC it will connect to. */
  readonly cidr: string;
  /**
   * Explicit AZ names, e.g. ["us-east-1a", "us-east-1b"]. Two or more = highly available.
   * Explicit (instead of "maxAzs") so synthesis needs NO AWS API call, which keeps CI synthesis
   * synth step simple and the output deterministic.
   */
  readonly availabilityZones: string[];
  /** NAT gateways to create. 1 = cheap (shared), one per AZ = highly available. 0 = none. */
  readonly natGateways: number;
  readonly subnets: SubnetLayoutProps;
  /** Create free S3 + DynamoDB gateway endpoints so that traffic skips the NAT. */
  readonly enableGatewayEndpoints: boolean;
  /** Record VPC Flow Logs in CloudWatch (who talked to whom). Used for audit and troubleshooting. */
  readonly enableFlowLogs: boolean;
}

/** One side of a VPC peering connection. */
export interface PeeringSideProps {
  readonly vpc: ec2.IVpc;
  /** Subnets whose route tables must learn the route to the OTHER VPC. */
  readonly routeSubnets: ec2.ISubnet[];
}

export interface VpcPeeringProps {
  readonly name: string;
  readonly requester: PeeringSideProps;
  readonly accepter: PeeringSideProps;
}

/** A VPC that plugs into a Transit Gateway. */
export interface TransitGatewayAttachmentProps {
  readonly name: string;
  readonly vpc: ec2.IVpc;
  /** One subnet per AZ that the TGW will place an ENI in. */
  readonly attachSubnets: ec2.ISubnet[];
  /** Subnets whose route tables get routes to every OTHER attached VPC. */
  readonly routeSubnets: ec2.ISubnet[];
}

export interface TransitGatewayHubProps {
  readonly name: string;
  /** Private ASN of the AWS side. Only matters when you add VPN / Direct Connect (BGP). */
  readonly amazonSideAsn: number;
  readonly attachments: TransitGatewayAttachmentProps[];
}

export interface PrivateHostedZoneProps {
  /** e.g. "dev.orderflow.internal". Resolvable ONLY from the VPCs listed below. */
  readonly zoneName: string;
  readonly vpcs: ec2.IVpc[];
}

/** A small EC2 box in the "on-prem" (client) VPC used to prove hybrid connectivity. */
export interface ClientHostProps {
  readonly vpc: ec2.IVpc;
  readonly instanceType: ec2.InstanceType;
}
