/**
 * PROPS: DATA + MESSAGING (DynamoDB, S3, SQS, SNS)
 */
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export interface GsiProps {
  readonly indexName: string;
  readonly partitionKey: string;
  readonly sortKey?: string;
}

export interface DynamoTableProps {
  readonly tableName: string;
  readonly partitionKey: string;
  readonly sortKey?: string;
  readonly globalSecondaryIndexes: GsiProps[];
  /** Continuous backups; restore to any second in the last 35 days. Turn on for prod. */
  readonly pointInTimeRecovery: boolean;
  /** DESTROY = table is deleted with the stack (dev). RETAIN = survives stack deletion (prod). */
  readonly removalPolicy: cdk.RemovalPolicy;
  readonly billingMode: dynamodb.BillingMode;
}

export interface SecureBucketProps {
  /** Leave undefined to let CloudFormation generate a globally unique name (recommended). */
  readonly bucketName?: string;
  readonly versioned: boolean;
  readonly removalPolicy: cdk.RemovalPolicy;
  /** Empties the bucket on stack delete. Only valid with removalPolicy DESTROY. */
  readonly autoDeleteObjects: boolean;
  /** Delete objects after N days (cost control). Undefined = keep forever. */
  readonly expireAfterDays?: number;
}

export interface QueueWithDlqProps {
  readonly queueName: string;
  /** Must be >= the consumer Lambda timeout, otherwise messages get delivered twice. */
  readonly visibilityTimeoutSeconds: number;
  /** After this many failed receives, SQS moves the message to the DLQ. */
  readonly maxReceiveCount: number;
  readonly retentionDays: number;
  readonly dlqRetentionDays: number;
}

export interface EventTopicProps {
  readonly topicName: string;
  /** Optional e-mail subscribers (each must click the confirmation link). */
  readonly emailSubscriptions: string[];
}
