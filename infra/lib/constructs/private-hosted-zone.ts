/**
 * CONSTRUCT (L3): PrivateHostedZone  (Amazon Route 53)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   A *private* hosted zone, e.g. "dev.orderflow.internal", associated with several VPCs, plus
 *   helper methods to add records that point to load balancers.
 *
 * PUBLIC vs PRIVATE hosted zone
 *   Public:  answers anyone on the internet (needs a domain you own / registered).
 *   Private: answers ONLY queries coming from the VPCs it is associated with, via the
 *            VPC's built-in resolver (the ".2" address, e.g. 10.10.0.2).
 *
 * WHY WE USE IT HERE
 *   Pods in the EKS VPC call  http://internal.dev.orderflow.internal  and DNS returns the PRIVATE IPs
 *   of the internal ALB in the App VPC. The traffic then rides the peering connection.
 *   The Client VPC resolves the very same name and uses the Transit Gateway instead.
 *   Same name, different network path.
 *
 * ALIAS vs CNAME
 *   ALIAS (A record): AWS-only extension. Free queries, works at the zone apex, and follows the
 *   ALB's changing IPs. A CNAME cannot be used at the apex. Prefer ALIAS for AWS targets.
 *
 * HYBRID NOTE: real on-prem DNS cannot see a private zone by default. You would add Route 53
 * Resolver INBOUND endpoints (on-prem -> AWS) and OUTBOUND endpoints + rules (AWS -> on-prem).
 * They are omitted here because they bill per endpoint-hour.
 *
 * DEPENDENCY: the VPCs must exist first; records depend on the load balancers existing.
 */
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { PrivateHostedZoneProps } from '../props/network-props';

export class PrivateHostedZone extends Construct {
  public readonly zone: route53.PrivateHostedZone;

  constructor(scope: Construct, id: string, props: PrivateHostedZoneProps) {
    super(scope, id);

    const [first, ...others] = props.vpcs;
    // A private zone is created with ONE VPC; further VPCs are associated afterwards.
    this.zone = new route53.PrivateHostedZone(this, 'Zone', {
      zoneName: props.zoneName,
      vpc: first,
    });
    others.forEach((vpc) => this.zone.addVpc(vpc));
  }

  /** Create `<recordName>.<zoneName>` as an ALIAS to a load balancer. */
  public addAliasToAlb(recordName: string, alb: elbv2.IApplicationLoadBalancer): route53.ARecord {
    return new route53.ARecord(this, `Alias-${recordName}`, {
      zone: this.zone,
      recordName,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
    });
  }
}
