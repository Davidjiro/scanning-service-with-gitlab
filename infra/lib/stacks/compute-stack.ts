/**
 * STACK: ComputeStack
 * ---------------------------------------------------------------------------
 * Everything that RUNS code. Depends on:
 *   - NetworkStack : VPC for the Lambda ENI, ALBs and Fargate tasks
 *   - DataStack    : table / bucket / queue / topic that the code uses
 *
 * CREATION ORDER INSIDE THIS STACK (each step needs the previous ones)
 *   1. validate Lambda                     (no dependencies)
 *   2. State machine                       (needs validate Lambda + table + bucket + topic)
 *   3. worker Lambda                       (needs the state machine ARN -> that is why it comes AFTER)
 *   4. SQS -> worker event source mapping  (needs queue + worker)
 *   5. api-handler Lambda (in the VPC)     (needs table + topic)
 *   6. API Gateway                         (needs the api-handler Lambda)
 *   7. ECS services + ALBs                 (need VPC + table for the task role)
 *
 *   Flow:  API GW → api-handler → DynamoDB + SNS → SQS → worker → Step Functions → DynamoDB/S3/SNS
 */
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eventsources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';
import { PythonLambda } from '../constructs/python-lambda';
import { LambdaRestApi } from '../constructs/lambda-rest-api';
import { OrderStateMachine } from '../constructs/order-state-machine';
import { FargateAlbService } from '../constructs/fargate-alb-service';
import { NetworkStack } from './network-stack';
import { DataStack } from './data-stack';
import { EnvironmentConfig } from '../config/environments';
import {
  apiHandlerConfig,
  validateConfig,
  workerConfig,
  apiGatewayConfig,
  stateMachineConfig,
  webServiceConfig,
  internalServiceConfig,
} from '../config/compute.config';

export interface ComputeStackProps extends cdk.StackProps {
  readonly envConfig: EnvironmentConfig;
  readonly network: NetworkStack;
  readonly data: DataStack;
}

export class ComputeStack extends cdk.Stack {
  public readonly webService: FargateAlbService;
  public readonly internalService: FargateAlbService;
  public readonly api: LambdaRestApi;
  public readonly stateMachine: OrderStateMachine;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);
    const { envConfig, network, data } = props;
    const table = data.ordersTable.table;
    const bucket = data.receiptsBucket.bucket;
    const topic = data.orderEvents.topic;
    const queue = data.ordersQueue.queue;

    // 1) validate Lambda ----------------------------------------------------------------------
    const validateFn = new PythonLambda(this, 'ValidateFn', {
      ...validateConfig(envConfig),
      environment: {},
    });

    // 2) State machine ------------------------------------------------------------------------
    this.stateMachine = new OrderStateMachine(this, 'OrderWorkflow', {
      ...stateMachineConfig(envConfig),
      validateFunction: validateFn.function,
      table,
      receiptsBucket: bucket,
      topic,
    });

    // 3) worker Lambda (starts executions) ----------------------------------------------------
    const workerFn = new PythonLambda(this, 'WorkerFn', {
      ...workerConfig(envConfig),
      environment: { STATE_MACHINE_ARN: this.stateMachine.stateMachine.stateMachineArn },
    });
    this.stateMachine.stateMachine.grantStartExecution(workerFn.function); // least privilege: just this SM

    // 4) SQS -> worker ------------------------------------------------------------------------
    workerFn.function.addEventSource(
      new eventsources.SqsEventSource(queue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true, // enables partial batch responses (see worker/handler.py)
      }),
    );

    // 5) api-handler Lambda, placed in the PRIVATE subnets of the app VPC ---------------------
    const apiFn = new PythonLambda(this, 'ApiFn', {
      ...apiHandlerConfig(envConfig),
      environment: { TABLE_NAME: table.tableName, TOPIC_ARN: topic.topicArn },
      vpc: network.appVpc.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
    table.grantReadWriteData(apiFn.function);
    topic.grantPublish(apiFn.function);

    // 6) API Gateway --------------------------------------------------------------------------
    this.api = new LambdaRestApi(this, 'OrdersApi', {
      ...apiGatewayConfig(envConfig),
      handler: apiFn.function,
    });

    // 7) ECS services + ALBs ------------------------------------------------------------------
    const vpc = network.appVpc.vpc;
    const commonEnv = { ENV_NAME: envConfig.name, PLATFORM: 'ecs', TABLE_NAME: table.tableName };

    this.webService = new FargateAlbService(this, 'WebService', {
      ...webServiceConfig(envConfig),
      vpc,
      environment: { ...commonEnv, ROLE: 'web' },
      allowedIngressCidrs: [], // public ALB: SG opens port 80 to the internet instead
    });
    table.grantReadData(this.webService.taskDefinition.taskRole);

    this.internalService = new FargateAlbService(this, 'InternalService', {
      ...internalServiceConfig(envConfig),
      vpc,
      environment: { ...commonEnv, ROLE: 'internal' },
      // Who may call the INTERNAL ALB: the peered EKS VPC and the "on-prem" client VPC (via TGW).
      // The App VPC itself is allowed too (same-VPC callers). Lattice is added in DiscoveryStack.
      allowedIngressCidrs: [envConfig.cidrs.eks, envConfig.cidrs.client, envConfig.cidrs.app],
    });
    table.grantReadData(this.internalService.taskDefinition.taskRole);

    // Outputs -----------------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', { value: this.api.api.url, description: 'POST {url}orders' });
    new cdk.CfnOutput(this, 'WebAlbUrl', {
      value: `http://${this.webService.loadBalancer.loadBalancerDnsName}`,
      description: 'Public ALB: curl {url}/whoami',
    });
    new cdk.CfnOutput(this, 'InternalAlbDnsName', {
      value: this.internalService.loadBalancer.loadBalancerDnsName,
      description: 'Private ALB DNS name (resolves to private IPs)',
    });
    new cdk.CfnOutput(this, 'StateMachineArn', { value: this.stateMachine.stateMachine.stateMachineArn });
    // The SAME image that ECS runs is deployed to EKS (see apps/eks/deployment.yaml).
    new cdk.CfnOutput(this, 'ImageUri', {
      value: this.webService.taskDefinition.defaultContainer!.imageName,
      description: 'Container image in ECR (built by CDK from apps/service)',
    });
  }
}
