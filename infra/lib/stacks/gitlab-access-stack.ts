/**
 * STACK: GitlabAccessStack  (one per AWS account, deployed ONCE by a human)
 * ---------------------------------------------------------------------------
 * Chicken-and-egg: the GitLab pipeline needs an IAM role to deploy, so that role cannot be created BY
 * the pipeline. You deploy this small stack once per account with your own credentials; afterwards
 * GitLab deploys everything else.
 *
 *      orderflow-dev-gitlab-access   (dev account)    role: orderflow-dev-gitlab-deploy
 *      orderflow-qa-gitlab-access    (qa account)     role: orderflow-qa-gitlab-deploy
 *      orderflow-prod-gitlab-access  (prod account)   role: orderflow-prod-gitlab-deploy
 *
 * It is NOT part of AppStage on purpose: the application can be destroyed and recreated without ever
 * deleting the identity the pipeline uses to do it.
 *
 * The output `DeployRoleArn` goes into the GitLab CI/CD variable AWS_ROLE_ARN_<ENV>.
 */
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { GitlabOidcRole } from '../constructs/gitlab-oidc-role';
import { EnvironmentConfig } from '../config/environments';
import { gitlabAccessConfig } from '../config/gitlab.config';

export interface GitlabAccessStackProps extends cdk.StackProps {
  readonly envConfig: EnvironmentConfig;
}

export class GitlabAccessStack extends cdk.Stack {
  public readonly access: GitlabOidcRole;

  constructor(scope: Construct, id: string, props: GitlabAccessStackProps) {
    super(scope, id, props);

    this.access = new GitlabOidcRole(this, 'GitlabOidcRole', gitlabAccessConfig(props.envConfig));

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: this.access.role.roleArn,
      description: `Set as the GitLab CI/CD variable AWS_ROLE_ARN_${props.envConfig.name.toUpperCase()}`,
    });
  }
}
