/**
 * CONSTRUCT (L3): PythonLambda  (AWS Lambda)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   A Python Lambda function with our standards:
 *     - ARM64 (Graviton): ~20% cheaper per GB-second and often faster than x86
 *     - X-Ray active tracing
 *     - an explicit log group with retention (otherwise logs are kept FOREVER and cost money)
 *     - optional placement inside a VPC (private subnets)
 *
 * KEY CONCEPTS
 *   Execution role      The IAM identity the function runs as. CDK creates one; we add permissions
 *                       with `table.grantReadWriteData(fn)` style helpers (least privilege).
 *   Cold start          First invocation (or scale-out) initialises a new execution environment.
 *                       Code outside the handler runs once per environment and is reused ("warm").
 *   Concurrency         Each in-flight request = one environment. Reserved concurrency caps/guarantees it.
 *   Timeout/memory      Memory also scales CPU. Timeout max 15 min. For SQS, queue visibility timeout
 *                       must be >= function timeout.
 *
 * LAMBDA IN A VPC (trade-offs, often asked)
 *   Lambda is NOT in your VPC by default; it runs in an AWS-managed network and has internet access.
 *   Put it in a VPC ONLY to reach private resources (RDS, internal ALB...). Then:
 *     - it gets an ENI in YOUR subnets and obeys YOUR route tables + security groups
 *     - it loses internet access unless the subnet routes to a NAT gateway (our private subnets do)
 *     - AWS services stay reachable via NAT or VPC endpoints (our gateway endpoints cover S3/DynamoDB)
 *
 * DEPENDENCIES: if `vpc` is given, the VPC (and its NAT) must exist first.
 */
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { PythonLambdaProps } from '../props/compute-props';

export class PythonLambda extends Construct {
  public readonly function: lambda.Function;
  public readonly securityGroup?: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: PythonLambdaProps) {
    super(scope, id);

    let securityGroups = props.securityGroups;
    if (props.vpc && !securityGroups) {
      // Egress-only SG: no inbound rules are needed because Lambda is never "connected to".
      this.securityGroup = new ec2.SecurityGroup(this, 'Sg', {
        vpc: props.vpc,
        description: `${props.functionName} lambda egress`,
        allowAllOutbound: true,
      });
      securityGroups = [this.securityGroup];
    }

    this.function = new lambda.Function(this, 'Function', {
      functionName: props.functionName,
      runtime: lambda.Runtime.PYTHON_3_13,
      architecture: lambda.Architecture.ARM_64,
      handler: props.handler,
      code: lambda.Code.fromAsset(props.codePath),
      memorySize: props.memorySize,
      timeout: props.timeout,
      environment: props.environment,
      tracing: lambda.Tracing.ACTIVE,
      logGroup: new logs.LogGroup(this, 'Logs', {
        retention: props.logRetentionDays as logs.RetentionDays,
        removalPolicy: cdk.RemovalPolicy.DESTROY, // logs are disposable: delete them with the stack
      }),
      vpc: props.vpc,
      vpcSubnets: props.vpc ? props.vpcSubnets ?? { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS } : undefined,
      securityGroups,
    });
  }
}
