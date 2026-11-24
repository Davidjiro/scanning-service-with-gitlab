/**
 * CONFIG: DATA + MESSAGING  ->  fills the props in `props/data-props.ts`
 *
 * Pattern used everywhere: dev is disposable (DESTROY), prod is protected (RETAIN).
 */
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { EnvironmentConfig, resourceName } from './environments';
import {
  DynamoTableProps,
  SecureBucketProps,
  QueueWithDlqProps,
  EventTopicProps,
} from '../props/data-props';

/** Seconds a worker Lambda may run. The queue's visibility timeout is derived from it (6x rule). */
export const WORKER_TIMEOUT_SECONDS = 30;

export function ordersTableConfig(env: EnvironmentConfig): DynamoTableProps {
  return {
    tableName: resourceName(env, 'orders'),
    partitionKey: 'orderId',
    globalSecondaryIndexes: [
      // Lets us answer "show all orders with status X, newest first".
      { indexName: 'by-status', partitionKey: 'status', sortKey: 'createdAt' },
    ],
    pointInTimeRecovery: env.isProd,
    removalPolicy: env.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  };
}

export function receiptsBucketConfig(env: EnvironmentConfig): SecureBucketProps {
  return {
    versioned: env.isProd,
    removalPolicy: env.isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    autoDeleteObjects: !env.isProd,
    expireAfterDays: env.isProd ? undefined : 30,
  };
}

export function ordersQueueConfig(env: EnvironmentConfig): QueueWithDlqProps {
  return {
    queueName: resourceName(env, 'orders-queue'),
    visibilityTimeoutSeconds: WORKER_TIMEOUT_SECONDS * 6,
    maxReceiveCount: 3, // 3 failed attempts, then the message moves to the DLQ
    retentionDays: 4,
    dlqRetentionDays: 14,
  };
}

export function orderEventsTopicConfig(env: EnvironmentConfig): EventTopicProps {
  return {
    topicName: resourceName(env, 'order-events'),
    emailSubscriptions: env.notificationEmail ? [env.notificationEmail] : [],
  };
}
