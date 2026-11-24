/**
 * CONFIG: GITLAB ACCESS  ->  fills `GitlabAccessProps` (props/gitlab-props.ts)
 *
 * Needed ONLY when you deploy the one-time access stack (`-c mode=gitlab-access`).
 * No secrets are involved: we only describe WHICH GitLab project may deploy.
 *
 *   export GITLAB_PROJECT_PATH="my-group/gitlab-aws-app"     # required
 *   export GITLAB_HOST="gitlab.com"                          # optional (self-managed GitLab: your host)
 *   export GITLAB_DEFAULT_BRANCH="main"                      # optional
 *   export GITLAB_EXISTING_OIDC_PROVIDER_ARN="arn:aws:iam::<acct>:oidc-provider/gitlab.com"   # optional
 */
import { GitlabAccessProps } from '../props/gitlab-props';
import { EnvironmentConfig, resourceName } from './environments';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`gitlab-access mode needs the environment variable ${name}. See the root README.`);
  }
  return value;
}

export function gitlabAccessConfig(env: EnvironmentConfig): GitlabAccessProps {
  const gitlabHost = process.env.GITLAB_HOST ?? 'gitlab.com';
  const defaultBranch = process.env.GITLAB_DEFAULT_BRANCH ?? 'main';
  return {
    gitlabHost,
    audience: `https://${gitlabHost}`,
    projectPath: required('GITLAB_PROJECT_PATH'),
    // dev: any branch (merge-request pipelines run `cdk diff` against dev).
    // qa / prod: ONLY the default branch. A feature branch can never touch them, whatever the YAML says.
    allowedBranches: env.name === 'dev' ? ['*'] : [defaultBranch],
    roleName: resourceName(env, 'gitlab-deploy'),
    maxSessionHours: 2,
    cdkQualifier: 'hnb659fds',
    existingProviderArn: process.env.GITLAB_EXISTING_OIDC_PROVIDER_ARN,
  };
}
