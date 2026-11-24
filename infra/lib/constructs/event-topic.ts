/**
 * CONSTRUCT (L3): EventTopic  (Amazon SNS)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   An SNS topic (pub/sub) with optional e-mail subscribers and a helper to fan out to SQS
 *   queues WITH A FILTER POLICY.
 *
 * KEY CONCEPTS
 *   Fan-out             One publish -> many independent subscribers (SQS, Lambda, HTTP, email, SMS).
 *   Filter policy       A subscriber receives only messages whose ATTRIBUTES match. Filtering happens
 *                       inside SNS, so you are not charged for deliveries that are filtered out.
 *   Raw message delivery  Without it SNS wraps your payload in a JSON envelope. With `true`, the SQS
 *                       message body is exactly what you published (simpler consumers), and SNS
 *                       message attributes arrive as SQS message attributes.
 *   Standard vs FIFO    We use Standard (best-effort ordering, high throughput).
 *
 * WHY WE FILTER HERE
 *   Both "order.created" (from the API Lambda) and "order.processed" (from Step Functions) are
 *   published to this topic. The worker queue must only get `order.created`, otherwise the
 *   system would reprocess its own output in an infinite loop.
 *
 * PERMISSIONS: `SqsSubscription` automatically adds a queue policy that allows THIS topic to
 * SendMessage to THAT queue (a resource-based policy). Publishers get `topic.grantPublish(role)`.
 *
 * DEPENDENCIES: none to create; subscriptions depend on both topic and queue.
 */
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { EventTopicProps } from '../props/data-props';

export class EventTopic extends Construct {
  public readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: EventTopicProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, 'Topic', {
      topicName: props.topicName,
      enforceSSL: true,
    });

    props.emailSubscriptions
      .filter((email) => email.length > 0)
      .forEach((email) => this.topic.addSubscription(new subs.EmailSubscription(email)));
  }

  /** Deliver only messages whose `event_type` attribute is in `allowedEventTypes` to `queue`. */
  public subscribeQueue(queue: sqs.IQueue, allowedEventTypes: string[]): void {
    this.topic.addSubscription(
      new subs.SqsSubscription(queue, {
        rawMessageDelivery: true,
        filterPolicy: {
          event_type: sns.SubscriptionFilter.stringFilter({ allowlist: allowedEventTypes }),
        },
      }),
    );
  }
}
