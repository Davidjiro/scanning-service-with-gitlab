/**
 * CONSTRUCT (L3): SecureBucket  (Amazon S3)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   An S3 bucket that is private and safe BY DEFAULT:
 *     - BlockPublicAccess.BLOCK_ALL   : no public ACLs or public bucket policies, ever
 *     - enforceSSL                    : bucket policy denies any non-HTTPS request
 *     - SSE-S3 encryption             : objects encrypted at rest (AES-256, free)
 *     - optional versioning           : protects against overwrites and deletes
 *     - optional lifecycle expiry     : automatic clean-up to control cost
 *
 * KEY CONCEPTS
 *   - S3 is a regional service with GLOBALLY unique bucket names. Prefer letting CloudFormation
 *     generate the name (leave bucketName undefined) to avoid collisions across 3 accounts.
 *   - Strong read-after-write consistency for all operations (since Dec 2020).
 *   - Access = IAM identity policy AND/OR bucket policy. Cross-account needs BOTH sides.
 *   - Storage classes: Standard, Intelligent-Tiering, Standard-IA, Glacier tiers... use a
 *     lifecycle rule to transition/expire.
 *   - removalPolicy DESTROY + autoDeleteObjects: CDK adds a small custom-resource Lambda that
 *     empties the bucket before deleting it (a bucket with objects cannot be deleted).
 *
 * DEPENDENCIES: none. Grant access with `bucket.grantReadWrite(role)`.
 */
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { SecureBucketProps } from '../props/data-props';

export class SecureBucket extends Construct {
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SecureBucketProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, 'Bucket', {
      bucketName: props.bucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: props.versioned,
      removalPolicy: props.removalPolicy,
      autoDeleteObjects: props.autoDeleteObjects,
      lifecycleRules: props.expireAfterDays
        ? [
            {
              id: 'expire-old-objects',
              expiration: cdk.Duration.days(props.expireAfterDays),
              // Versioned buckets also keep old versions; clean those up as well.
              noncurrentVersionExpiration: props.versioned ? cdk.Duration.days(props.expireAfterDays) : undefined,
              abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
            },
          ]
        : undefined,
    });
  }
}
