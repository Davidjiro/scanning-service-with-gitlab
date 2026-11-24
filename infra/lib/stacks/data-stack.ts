/**
 * STACK: DataStack
 * ---------------------------------------------------------------------------
 * Stateful and messaging resources: DynamoDB, S3, SQS (+DLQ), SNS.
 *
 * WHY A SEPARATE STACK?  Stateful resources change rarely and are dangerous to delete.
 * Keeping them apart from compute (which changes every deploy) limits the blast radius and
 * lets you set termination protection on just this stack in prod.
 *
 * DOES NOT DEPEND ON NetworkStack: these services are regional and accessed through IAM.
 * ComputeStack depends on THIS stack (it receives the table/bucket/queue/topic objects).
 *
 *   SNS topic --(filter: order.created)--> SQS queue --(dead letters)--> DLQ
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { DynamoTable } from '../constructs/dynamo-table';
import { SecureBucket } from '../constructs/secure-bucket';
import { QueueWithDlq } from '../constructs/queue-with-dlq';
import { EventTopic } from '../constructs/event-topic';
import { EnvironmentConfig } from '../config/environments';
import {
  ordersTableConfig,
  receiptsBucketConfig,
  ordersQueueConfig,
  orderEventsTopicConfig,
} from '../config/data.config';

export interface DataStackProps extends cdk.StackProps {
  readonly envConfig: EnvironmentConfig;
}

export class DataStack extends cdk.Stack {
  public readonly ordersTable: DynamoTable;
  public readonly receiptsBucket: SecureBucket;
  public readonly ordersQueue: QueueWithDlq;
  public readonly orderEvents: EventTopic;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { envConfig } = props;

    this.ordersTable = new DynamoTable(this, 'OrdersTable', ordersTableConfig(envConfig));
    this.receiptsBucket = new SecureBucket(this, 'ReceiptsBucket', receiptsBucketConfig(envConfig));
    this.ordersQueue = new QueueWithDlq(this, 'OrdersQueue', ordersQueueConfig(envConfig));
    this.orderEvents = new EventTopic(this, 'OrderEvents', orderEventsTopicConfig(envConfig));

    // Wire SNS -> SQS with the filter described in event-topic.ts.
    this.orderEvents.subscribeQueue(this.ordersQueue.queue, ['order.created']);

    // Stop accidental `cdk destroy` in prod.
    if (envConfig.isProd) {
      this.terminationProtection = true;
    }

    // Outputs used by the README commands and scripts.
    new cdk.CfnOutput(this, 'OrdersTableName', { value: this.ordersTable.table.tableName });
    new cdk.CfnOutput(this, 'ReceiptsBucketName', { value: this.receiptsBucket.bucket.bucketName });
    new cdk.CfnOutput(this, 'OrdersQueueUrl', { value: this.ordersQueue.queue.queueUrl });
    new cdk.CfnOutput(this, 'OrdersDlqUrl', { value: this.ordersQueue.deadLetterQueue.queueUrl });
    new cdk.CfnOutput(this, 'OrderEventsTopicArn', { value: this.orderEvents.topic.topicArn });
  }
}
