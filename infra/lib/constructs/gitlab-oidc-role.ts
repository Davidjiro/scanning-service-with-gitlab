/**
 * CONSTRUCT (L3): GitlabOidcRole  (IAM OIDC identity provider + deploy role)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   1. An IAM OpenID Connect (OIDC) identity provider that trusts GitLab ("https://gitlab.com")
 *   2. An IAM role that a GitLab CI job can assume, and nothing else can
 *
 * WHY OIDC INSTEAD OF AWS ACCESS KEYS IN GITLAB VARIABLES?
 *   Access keys are long-lived secrets: they leak, get copied, and need rotation.
 *   With OIDC there is NO secret stored anywhere:
 *
 *     GitLab job ──(1) GitLab signs a short-lived JWT "ID token" for THIS job──────────────┐
 *        │                                                                                 │
 *        └─(2) aws sts assume-role-with-web-identity (token + role ARN)──► AWS STS         │
 *                                   (3) STS fetches GitLab's public keys and verifies <────┘
 *                                   (4) STS checks the role's TRUST POLICY against the token claims
 *        ◄─(5) temporary credentials (valid ≤ 2 h)
 *
 * THE TOKEN CLAIMS THAT MATTER
 *   aud  audience   who the token is for. Must equal what we registered on the provider.
 *   sub  subject    "project_path:<group>/<project>:ref_type:branch:ref:<branch>"
 *                   This is what makes the role specific to ONE project and ONE branch.
 *   Trust policy:   StringEquals  <host>:aud = audience
 *                   StringLike    <host>:sub = project_path:<project>:ref_type:branch:ref:<allowed>
 *   If an attacker's project (different path) or a feature branch (different ref) asks for qa/prod
 *   credentials, the Condition fails and STS answers AccessDenied.
 *
 * WHAT THE ROLE MAY DO (least privilege)
 *   It does NOT get admin. It may only:
 *     - sts:AssumeRole the CDK bootstrap roles (deploy, file-publishing, image-publishing, lookup).
 *       Those roles are what really create resources: CloudFormation runs as the "cfn-exec" role.
 *     - cloudformation:DescribeStacks (so scripts can read stack outputs for smoke tests).
 *   So a stolen token can do exactly what `cdk deploy` can do, nothing broader, and only for ≤ 2 hours.
 *
 * DEPENDENCIES: the account must be CDK-bootstrapped (the cdk-<qualifier>-* roles must exist) before a
 * pipeline job can deploy. This stack itself needs no bootstrap role at deploy time, but we deploy it
 * with `cdk deploy` so the account needs bootstrapping anyway.
 *
 * ONE PROVIDER PER URL PER ACCOUNT: if the account already has one for GitLab, set
 * GITLAB_EXISTING_OIDC_PROVIDER_ARN and we reuse it instead of failing with "EntityAlreadyExists".
 */
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { GitlabAccessProps } from '../props/gitlab-props';

export class GitlabOidcRole extends Construct {
  public readonly role: iam.Role;
  public readonly provider: iam.IOidcProvider;

  constructor(scope: Construct, id: string, props: GitlabAccessProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);

    // 1) The identity provider (the trust relationship between AWS and GitLab).
    this.provider = props.existingProviderArn
      ? iam.OidcProviderNative.fromOidcProviderArn(this, 'Provider', props.existingProviderArn)
      : new iam.OidcProviderNative(this, 'Provider', {
          url: `https://${props.gitlabHost}`,
          clientIds: [props.audience], // the only audience AWS will accept
        });

    // 2) Trust policy: WHO may assume the role.
    const subjects = props.allowedBranches.map(
      (branch) => `project_path:${props.projectPath}:ref_type:branch:ref:${branch}`,
    );
    const principal = new iam.WebIdentityPrincipal(this.provider.oidcProviderArn, {
      StringEquals: { [`${props.gitlabHost}:aud`]: props.audience },
      StringLike: { [`${props.gitlabHost}:sub`]: subjects },
    });

    this.role = new iam.Role(this, 'DeployRole', {
      roleName: props.roleName,
      description: `GitLab project ${props.projectPath} -> CDK deploy (branches: ${props.allowedBranches.join(', ')})`,
      assumedBy: principal,
      maxSessionDuration: cdk.Duration.hours(props.maxSessionHours),
    });

    // 3) Permissions: WHAT it may do once assumed.
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole'],
        // cdk-hnb659fds-deploy-role-<account>-<region>, ...-file-publishing-role-..., etc.
        resources: [`arn:${stack.partition}:iam::${stack.account}:role/cdk-${props.cdkQualifier}-*-role-${stack.account}-${stack.region}`],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:${stack.partition}:cloudformation:${stack.region}:${stack.account}:stack/orderflow-*/*`],
      }),
    );
  }
}
