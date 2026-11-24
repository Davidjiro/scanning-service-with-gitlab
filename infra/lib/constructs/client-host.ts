/**
 * CONSTRUCT (L3): ClientHost  ("on-prem" test machine)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   A small EC2 instance in the CLIENT VPC with:
 *     - NO inbound security-group rules at all (no SSH, no open ports)
 *     - the SSM Session Manager agent permission, so you get a shell with:
 *           aws ssm start-session --target <instance-id>
 *
 * WHY
 *   The Client VPC stands in for a corporate data centre. From this box you run
 *       curl http://internal.dev.orderflow.internal/whoami
 *   and prove that the hybrid path  Client VPC -> Transit Gateway -> App VPC -> internal ALB works.
 *
 * WHY SSM AND NOT SSH?  No key pairs to leak, no port 22 exposed, every session is logged
 * in CloudTrail and can be recorded to S3/CloudWatch. This is the expected modern answer.
 *
 * HOW DOES SSM REACH THE INSTANCE?  The agent makes OUTBOUND HTTPS calls to the SSM service.
 * Our instance lives in a public subnet with a public IP, so it uses the Internet Gateway for
 * that. (In a locked-down design you would use private subnets + interface VPC endpoints for
 * ssm, ssmmessages and ec2messages.)
 */
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ClientHostProps } from '../props/network-props';

export class ClientHost extends Construct {
  public readonly instance: ec2.Instance;
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: ClientHostProps) {
    super(scope, id);

    this.securityGroup = new ec2.SecurityGroup(this, 'Sg', {
      vpc: props.vpc,
      description: 'On-prem simulator: no inbound, outbound allowed',
      allowAllOutbound: true, // security groups are stateful: replies to our requests are allowed
    });

    const role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
    });

    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: props.instanceType,
      machineImage: ec2.MachineImage.latestAmazonLinux2023({ cpuType: ec2.AmazonLinuxCpuType.ARM_64 }),
      securityGroup: this.securityGroup,
      role,
      associatePublicIpAddress: true, // needed to reach SSM through the IGW
      requireImdsv2: true, // blocks SSRF-style credential theft from instance metadata
    });
  }
}
