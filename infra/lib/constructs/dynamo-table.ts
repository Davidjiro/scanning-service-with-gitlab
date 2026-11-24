/**
 * CONSTRUCT (L3): DynamoTable  (Amazon DynamoDB)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   A DynamoDB table with our standards: on-demand billing, encryption at rest, optional
 *   point-in-time recovery (PITR), deletion protection in prod, and optional GSIs.
 *
 * KEY CONCEPTS TO KNOW COLD
 *   Partition key (PK)  decides WHICH physical partition stores the item (hashed).
 *   Sort key (SK)       orders items inside one PK, enabling range queries. Optional.
 *   GSI                 an alternate PK/SK so you can query by another attribute
 *                       (here: all orders by `status`). Eventually consistent. Own capacity.
 *   Query  vs  Scan     Query reads one PK (cheap, fast). Scan reads EVERYTHING (slow, costly).
 *   On-demand vs        On-demand (PAY_PER_REQUEST): no capacity planning, great for spiky/unknown
 *   provisioned         traffic. Provisioned (+ auto scaling): cheaper for steady, predictable load.
 *   Hot partition       If one PK receives most traffic you throttle even with spare table capacity.
 *                       => choose high-cardinality keys (orderId, not "status" or a date).
 *
 * WHY IS THIS TABLE IN NO VPC?  DynamoDB is a regional public-endpoint service. Private access
 * is done with the free GATEWAY ENDPOINT we created in vpc-network.ts, plus IAM policies.
 *
 * DEPENDENCIES: none. Consumers (Lambda, ECS task role, Step Functions) get access with
 * `table.grantReadWriteData(role)`, which writes the least-privilege IAM policy for you.
 */
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { DynamoTableProps } from '../props/data-props';

export class DynamoTable extends Construct {
  public readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DynamoTableProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'Table', {
      tableName: props.tableName,
      partitionKey: { name: props.partitionKey, type: dynamodb.AttributeType.STRING },
      sortKey: props.sortKey ? { name: props.sortKey, type: dynamodb.AttributeType.STRING } : undefined,
      billingMode: props.billingMode,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.pointInTimeRecovery },
      // Deletion protection blocks accidental `DeleteTable` API calls. Only for RETAIN envs.
      deletionProtection: props.removalPolicy === cdk.RemovalPolicy.RETAIN,
      removalPolicy: props.removalPolicy,
    });

    props.globalSecondaryIndexes.forEach((gsi) => {
      this.table.addGlobalSecondaryIndex({
        indexName: gsi.indexName,
        partitionKey: { name: gsi.partitionKey, type: dynamodb.AttributeType.STRING },
        sortKey: gsi.sortKey ? { name: gsi.sortKey, type: dynamodb.AttributeType.STRING } : undefined,
        projectionType: dynamodb.ProjectionType.ALL,
      });
    });
  }
}
