/**
 * CONSTRUCT (L3): FargateAlbService  (Amazon ECS on Fargate + Application Load Balancer)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *
 *   client --80--> [ALB listener] --forward--> [TARGET GROUP] --8080--> [Fargate tasks]
 *                  (alb security group)        (health checks)         (service security group)
 *
 *   internetFacing = true  : ALB in PUBLIC subnets, public IPs, open to 0.0.0.0/0 on port 80
 *   internetFacing = false : ALB in PRIVATE subnets, private IPs only; open only to `allowedIngressCidrs`
 *   In BOTH cases the TASKS live in PRIVATE subnets with NO public IP.
 *
 * ECS VOCABULARY
 *   Cluster            Logical grouping (for Fargate it holds no servers you manage).
 *   Task definition    The blueprint: image, CPU/memory, env vars, ports, IAM roles, log config.
 *   Task               One running copy of the task definition (one or more containers).
 *   Service            Keeps N tasks running, replaces failed ones, registers them with the target
 *                      group, does rolling deployments (+ circuit breaker rollback).
 *   Two IAM roles      EXECUTION role: used by ECS itself to pull the image from ECR + write logs.
 *                      TASK role: used by the application code (e.g. DynamoDB access).
 *   Fargate            Serverless compute for containers: you pay per vCPU/GB-second, no EC2 to patch.
 *   awsvpc networking  Every task gets its OWN ENI + private IP + security group. That is why the
 *                      target group type is IP (not instance).
 *
 * ALB VOCABULARY (the target group part is the usual deep-dive)
 *   Load balancer      Layer 7 (HTTP/HTTPS/gRPC). Needs >= 2 subnets in different AZs.
 *   Listener           Port + protocol the ALB accepts (here HTTP:80). Holds rules.
 *   Rule               Condition (path, host, header...) -> action (forward / redirect / fixed response).
 *   TARGET GROUP       The set of destinations + HOW to check them:
 *                        - targetType  ip | instance | lambda | alb
 *                        - protocol/port used to talk to targets (8080)
 *                        - HEALTH CHECK: path, interval, timeout, healthy/unhealthy thresholds,
 *                          success codes. Unhealthy targets receive no traffic.
 *                        - deregistration delay: how long to drain in-flight requests (default 300s;
 *                          we use 30s so deployments are fast).
 *   NLB vs ALB         NLB = Layer 4, static IPs, millions of rps. ALB = Layer 7 routing features.
 *
 * SECURITY GROUP CHAIN (reference the SG, not an IP range, between tiers)
 *   Internet ──80──► albSg ──8080──► serviceSg        (service is NEVER directly reachable)
 *   If the ALB were deleted/replaced nothing else in the chain needs to change.
 *
 * HTTPS NOTE: production = ACM certificate + HTTPS:443 listener + HTTP->HTTPS redirect. HTTP is used
 * here only because the project has no registered domain or certificate.
 *
 * DEPENDENCY CHAIN
 *   VPC → (cluster, security groups) → ALB → listener → target group → service (registers tasks)
 *   The task definition needs the image (built + pushed to ECR by CDK at deploy time).
 */
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { FargateAlbServiceProps } from '../props/compute-props';

export class FargateAlbService extends Construct {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs.FargateService;
  public readonly taskDefinition: ecs.FargateTaskDefinition;
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  public readonly listener: elbv2.ApplicationListener;
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly serviceSecurityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: FargateAlbServiceProps) {
    super(scope, id);

    // ---------------------------------------------------------------- security groups
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: props.vpc,
      description: `${props.serviceName} ALB`,
      allowAllOutbound: false, // outbound is opened ONLY to the service SG, below
    });
    this.serviceSecurityGroup = new ec2.SecurityGroup(this, 'ServiceSg', {
      vpc: props.vpc,
      description: `${props.serviceName} tasks`,
      allowAllOutbound: true, // tasks must reach ECR, CloudWatch, DynamoDB... (via NAT / endpoints)
    });

    if (props.internetFacing) {
      this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP from the internet');
    } else {
      props.allowedIngressCidrs.forEach((cidr) =>
        this.albSecurityGroup.addIngressRule(ec2.Peer.ipv4(cidr), ec2.Port.tcp(80), `HTTP from ${cidr}`),
      );
    }
    // ALB -> tasks, SG to SG.
    this.albSecurityGroup.addEgressRule(this.serviceSecurityGroup, ec2.Port.tcp(props.containerPort), 'ALB to tasks');
    this.serviceSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(props.containerPort),
      'Only the ALB may reach the tasks',
    );

    // --------------------------------------------------------------- cluster + task definition
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc: props.vpc,
      containerInsightsV2: ecs.ContainerInsights.DISABLED, // enable in prod for per-task metrics (extra cost)
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: props.cpu,
      memoryLimitMiB: props.memoryMiB,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    this.taskDefinition.addContainer('app', {
      // Builds the Dockerfile locally (needs Docker running), pushes to the CDK bootstrap ECR repo.
      image: ecs.ContainerImage.fromAsset(props.dockerContextPath, {
        platform: ecr_assets.Platform.LINUX_ARM64,
      }),
      portMappings: [{ containerPort: props.containerPort }],
      environment: props.environment,
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: props.serviceName,
        logGroup: new logs.LogGroup(this, 'Logs', {
          retention: props.logRetentionDays as logs.RetentionDays,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      }),
    });

    // ---------------------------------------------------------------- load balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: props.internetFacing,
      securityGroup: this.albSecurityGroup,
      vpcSubnets: {
        subnetType: props.internetFacing ? ec2.SubnetType.PUBLIC : ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      dropInvalidHeaderFields: true, // defends against HTTP desync / request smuggling
    });

    // ---------------------------------------------------------------- target group
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc: props.vpc,
      targetType: elbv2.TargetType.IP, // Fargate (awsvpc) tasks register by IP
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: props.containerPort,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: props.healthCheckPath,
        protocol: elbv2.Protocol.HTTP,
        interval: cdk.Duration.seconds(15), // check every 15 s
        timeout: cdk.Duration.seconds(5), // a check fails if no answer in 5 s (must be < interval)
        healthyThresholdCount: 2, // 2 passes in a row => healthy (join traffic after ~30 s)
        unhealthyThresholdCount: 3, // 3 failures in a row => unhealthy (removed after ~45 s)
        healthyHttpCodes: '200',
      },
    });

    this.listener = this.loadBalancer.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false, // we manage ingress on our own SG; do not auto-open 0.0.0.0/0
      defaultTargetGroups: [this.targetGroup],
    });

    // ---------------------------------------------------------------- service
    this.service = new ecs.FargateService(this, 'Service', {
      serviceName: props.serviceName,
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: props.desiredCount,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.serviceSecurityGroup],
      assignPublicIp: false,
      minHealthyPercent: 100, // never drop below the desired count during a deploy
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true }, // auto-rollback a deployment whose tasks keep failing
      healthCheckGracePeriod: cdk.Duration.seconds(30), // ignore LB health during container boot
    });
    this.service.attachToApplicationTargetGroup(this.targetGroup);

    // Scale out when average CPU > 60 %. Max = 3x desired.
    this.service
      .autoScaleTaskCount({ minCapacity: props.desiredCount, maxCapacity: props.desiredCount * 3 })
      .scaleOnCpuUtilization('CpuScaling', { targetUtilizationPercent: 60 });
  }
}
