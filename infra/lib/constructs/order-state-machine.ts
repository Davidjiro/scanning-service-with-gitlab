/**
 * CONSTRUCT (L3): OrderStateMachine  (AWS Step Functions)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS  (Standard workflow, defined with the CDK fluent API -> Amazon States Language)
 *
 *   Validate (Lambda) ──► Valid? ──yes──► MarkProcessed (DynamoDB UpdateItem)
 *                           │                    │
 *                           │                    ▼
 *                           │            WriteReceipt (S3 PutObject)
 *                           │                    │
 *                           │                    ▼
 *                           │            PublishProcessed (SNS Publish) ──► Succeed
 *                           └──no───► MarkRejected (DynamoDB) ──► Fail
 *
 * KEY CONCEPTS
 *   Task states          Do work. Three styles shown here:
 *                          1. Lambda invoke (classic)
 *                          2. OPTIMISED integration  (DynamoDB UpdateItem, SNS Publish): no Lambda needed
 *                          3. AWS SDK integration    (S3 PutObject via CallAwsService): any AWS API call
 *                        Prefer 2 / 3 over writing glue Lambdas: less code, no cold starts, cheaper.
 *   Choice state         Branching on data. Pass/Succeed/Fail/Wait/Parallel/Map are the other types.
 *   Retry / Catch        Declarative error handling. We retry transient Lambda errors with back-off.
 *   Paths                $ = whole input. `resultPath` decides WHERE a task's output is stored in the
 *                        state JSON (we keep the original order and add `validation` next to it).
 *   Standard vs Express  Standard: up to 1 year, exactly-once, audit history, billed per transition.
 *                        Express: up to 5 min, at-least-once, very high volume, billed per duration.
 *                        Order processing with side effects => STANDARD.
 *   Execution role       The state machine runs as an IAM role. CDK adds exactly the permissions each
 *                        task needs (lambda:InvokeFunction, dynamodb:UpdateItem, s3:PutObject, sns:Publish).
 *
 * DEPENDENCIES: Validate Lambda, DynamoDB table, S3 bucket and SNS topic must exist first.
 * The worker Lambda (which STARTS executions) is created AFTER this construct.
 */
import * as cdk from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { OrderStateMachineProps } from '../props/compute-props';

export class OrderStateMachine extends Construct {
  public readonly stateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: OrderStateMachineProps) {
    super(scope, id);

    const orderKey = { orderId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.orderId')) };

    // 1) Validate: Lambda. `payloadResponseOnly` hands us just the function's return value.
    const validate = new tasks.LambdaInvoke(this, 'Validate', {
      lambdaFunction: props.validateFunction,
      payloadResponseOnly: true,
      resultPath: '$.validation', // original order stays at $, result added at $.validation
    });
    validate.addRetry({
      errors: ['Lambda.ServiceException', 'Lambda.AWSLambdaException', 'Lambda.SdkClientException', 'Lambda.TooManyRequestsException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    });

    // 2) Happy path.
    const markProcessed = new tasks.DynamoUpdateItem(this, 'MarkProcessed', {
      table: props.table,
      key: orderKey,
      updateExpression: 'SET #s = :s, processedAt = :t',
      expressionAttributeNames: { '#s': 'status' }, // "status" is a DynamoDB reserved word
      expressionAttributeValues: {
        ':s': tasks.DynamoAttributeValue.fromString('PROCESSED'),
        ':t': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });

    const writeReceipt = new tasks.CallAwsService(this, 'WriteReceipt', {
      service: 's3',
      action: 'putObject',
      parameters: {
        Bucket: props.receiptsBucket.bucketName,
        Key: sfn.JsonPath.format('receipts/{}.json', sfn.JsonPath.stringAt('$.orderId')),
        Body: sfn.JsonPath.jsonToString(sfn.JsonPath.objectAt('$')),
        ContentType: 'application/json',
      },
      iamResources: [props.receiptsBucket.arnForObjects('receipts/*')],
      resultPath: sfn.JsonPath.DISCARD,
    });

    const publishProcessed = new tasks.SnsPublish(this, 'PublishProcessed', {
      topic: props.topic,
      message: sfn.TaskInput.fromObject({
        orderId: sfn.JsonPath.stringAt('$.orderId'),
        status: 'PROCESSED',
      }),
      messageAttributes: {
        // The SQS subscription's filter only accepts "order.created", so this does NOT loop back.
        event_type: { value: 'order.processed', dataType: tasks.MessageAttributeDataType.STRING },
      },
      resultPath: sfn.JsonPath.DISCARD,
    });

    // 3) Unhappy path.
    const markRejected = new tasks.DynamoUpdateItem(this, 'MarkRejected', {
      table: props.table,
      key: orderKey,
      updateExpression: 'SET #s = :s, rejectReason = :r',
      expressionAttributeNames: { '#s': 'status' },
      expressionAttributeValues: {
        ':s': tasks.DynamoAttributeValue.fromString('REJECTED'),
        ':r': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.validation.reason')),
      },
      resultPath: sfn.JsonPath.DISCARD,
    });
    const rejected = new sfn.Fail(this, 'OrderRejected', { cause: 'Order failed validation' });
    const done = new sfn.Succeed(this, 'OrderProcessed');

    // 4) Wire the graph together.
    const definition = validate.next(
      new sfn.Choice(this, 'IsValid?')
        .when(
          sfn.Condition.booleanEquals('$.validation.valid', true),
          markProcessed.next(writeReceipt).next(publishProcessed).next(done),
        )
        .otherwise(markRejected.next(rejected)),
    );

    const logGroup = new logs.LogGroup(this, 'Logs', {
      retention: props.logRetentionDays as logs.RetentionDays,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: props.stateMachineName,
      stateMachineType: sfn.StateMachineType.STANDARD,
      definitionBody: sfn.DefinitionBody.fromChainable(definition),
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: true,
      logs: { destination: logGroup, level: sfn.LogLevel.ERROR, includeExecutionData: false },
    });
  }
}
