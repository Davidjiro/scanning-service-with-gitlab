/**
 * CONSTRUCT (L3): QueueWithDlq  (Amazon SQS)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   A standard SQS queue + a Dead Letter Queue (DLQ) wired together with a redrive policy.
 *
 *   producer --> [ main queue ] --> consumer
 *                      |  after `maxReceiveCount` failed attempts
 *                      v
 *                 [ DLQ ]  --> alarm / manual inspection / redrive
 *
 * KEY CONCEPTS
 *   Visibility timeout   When a consumer receives a message it becomes INVISIBLE for N seconds.
 *                        If not deleted in time it reappears (=> duplicate processing).
 *                        RULE: visibilityTimeout >= consumer Lambda timeout (AWS recommends 6x).
 *   At-least-once        Standard queues can deliver a message more than once and out of order.
 *                        Consumers must be IDEMPOTENT. (FIFO queues give ordering + dedup.)
 *   Long polling         Lambda's event source mapping polls for you.
 *   DLQ                  Poison messages must not block the queue forever. Retain them longer
 *                        than the main queue so you have time to investigate.
 *   SQS vs SNS           SQS = pull, one consumer group, buffering/back-pressure.
 *                        SNS = push, fan-out to many subscribers. Often used TOGETHER (fan-out).
 *
 * DEPENDENCIES: none to create. The SNS subscription (event-topic.ts) needs the queue to exist and
 * adds a queue policy letting that topic send messages.
 */
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { QueueWithDlqProps } from '../props/data-props';

export class QueueWithDlq extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: QueueWithDlqProps) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'Dlq', {
      queueName: `${props.queueName}-dlq`,
      retentionPeriod: cdk.Duration.days(props.dlqRetentionDays),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });

    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: props.queueName,
      visibilityTimeout: cdk.Duration.seconds(props.visibilityTimeoutSeconds),
      retentionPeriod: cdk.Duration.days(props.retentionDays),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: props.maxReceiveCount },
    });
  }
}
