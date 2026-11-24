/**
 * CONSTRUCT (L3): VpcNetwork
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   - A VPC with 3 subnet "tiers" spread over N Availability Zones
 *   - Internet Gateway (created implicitly by ec2.Vpc when a PUBLIC subnet exists)
 *   - NAT gateway(s) so PRIVATE subnets can reach the internet (egress only)
 *   - Free gateway endpoints for S3 + DynamoDB
 *   - Optional VPC Flow Logs
 *
 * WHY "L3"?  An L1 construct (CfnVpc) is 1:1 with CloudFormation. An L2 (ec2.Vpc) adds
 * sensible defaults. An L3 (this class) is OUR opinionated pattern: it combines several
 * L2s, enforces our standards and exposes a small, intention-revealing API.
 *
 * THE THREE TIERS
 *   PUBLIC    route table: 0.0.0.0/0 -> Internet Gateway.   Resources need a public IP to be
 *             reachable from the internet. Put ONLY load balancers / NAT here.
 *   PRIVATE   route table: 0.0.0.0/0 -> NAT Gateway.        Can call out (pull images, call AWS
 *             APIs), but nothing on the internet can start a connection IN. App compute lives here.
 *   ISOLATED  route table: local only. No NAT, no IGW.     Databases. Reach AWS services only
 *             through VPC endpoints.
 *
 * WHAT DEPENDS ON WHAT (inside this construct)
 *   IGW  -> needed by  public route table  -> needed by  NAT gateway (it sits in a public subnet)
 *   NAT  -> needed by  private route table
 *   Because CDK knows these edges it creates them in the right order for you.
 *
 * SECURITY GROUPS vs NACLs
 *   Security group: stateful, attached to an ENI, ALLOW rules only. (We use these everywhere.)
 *   NACL: stateless, attached to a subnet, ALLOW + DENY, evaluated by rule number. (Left at the
 *   permissive default; they are available as a second, coarse layer.)
 */
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { VpcNetworkProps } from '../props/network-props';

export class VpcNetwork extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: VpcNetworkProps) {
    super(scope, id);

    const { subnets } = props;
    const hasPrivate = subnets.privateCidrMask > 0;
    const hasIsolated = subnets.isolatedCidrMask > 0;

    // The ORDER of this array is the order CDK carves addresses out of the VPC CIDR.
    const subnetConfiguration: ec2.SubnetConfiguration[] = [
      {
        name: 'public',
        subnetType: ec2.SubnetType.PUBLIC,
        cidrMask: subnets.publicCidrMask,
        // Do NOT hand out public IPs automatically. A resource that needs one must ask for it.
        mapPublicIpOnLaunch: false,
      },
    ];
    if (hasPrivate) {
      subnetConfiguration.push({
        name: 'private',
        // With NAT => PRIVATE_WITH_EGRESS. Without NAT the subnet would have no way out.
        subnetType:
          props.natGateways > 0
            ? ec2.SubnetType.PRIVATE_WITH_EGRESS
            : ec2.SubnetType.PRIVATE_ISOLATED,
        cidrMask: subnets.privateCidrMask,
      });
    }
    if (hasIsolated) {
      subnetConfiguration.push({
        name: 'isolated',
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        cidrMask: subnets.isolatedCidrMask,
      });
    }

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: props.name,
      ipAddresses: ec2.IpAddresses.cidr(props.cidr),
      availabilityZones: props.availabilityZones,
      natGateways: props.natGateways,
      subnetConfiguration,
      // Needed so Route 53 private zones, VPC endpoints and EKS can resolve DNS names.
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // ---- Gateway endpoints (FREE). They add a route to the S3 / DynamoDB "prefix list" so
    // that traffic to those services never touches the NAT gateway (saves money + stays private).
    if (props.enableGatewayEndpoints) {
      const endpointSubnets: ec2.SubnetSelection[] = [];
      if (hasPrivate && props.natGateways > 0) {
        endpointSubnets.push({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS });
      }
      if (hasIsolated || (hasPrivate && props.natGateways === 0)) {
        endpointSubnets.push({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED });
      }
      if (endpointSubnets.length > 0) {
        this.vpc.addGatewayEndpoint('S3Endpoint', {
          service: ec2.GatewayVpcEndpointAwsService.S3,
          subnets: endpointSubnets,
        });
        this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
          service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
          subnets: endpointSubnets,
        });
      }
    }

    if (props.enableFlowLogs) {
      // Flow logs = metadata about accepted/rejected connections. First tool to reach for when
      // someone says "my service can't connect to X".
      this.vpc.addFlowLog('FlowLog', {
        trafficType: ec2.FlowLogTrafficType.REJECT, // only rejected traffic: cheaper, still useful
      });
    }

    cdk.Tags.of(this).add('NetworkName', props.name);
  }

  /** Subnets that carry a route to the Internet Gateway. */
  public get publicSubnets(): ec2.ISubnet[] {
    return this.vpc.publicSubnets;
  }

  /** App-tier subnets (egress-only through NAT, or fully isolated if NAT = 0). */
  public get privateSubnets(): ec2.ISubnet[] {
    return this.vpc.privateSubnets.length > 0 ? this.vpc.privateSubnets : this.vpc.isolatedSubnets;
  }
}
