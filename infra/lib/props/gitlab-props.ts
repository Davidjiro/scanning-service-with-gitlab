/**
 * PROPS: GITLAB CI/CD ACCESS TO AWS
 * ---------------------------------------------------------------------------
 * Describes HOW a GitLab CI job is allowed to become an IAM role in one AWS account.
 */

export interface GitlabAccessProps {
  /** Host of GitLab, without scheme: "gitlab.com" or your self-managed host. */
  readonly gitlabHost: string;
  /**
   * The `aud` (audience) claim that CI jobs request in their ID token. AWS only accepts tokens whose
   * audience was registered on the OIDC provider. Must equal `id_tokens: ... aud:` in .gitlab-ci.yml.
   */
  readonly audience: string;
  /** "group/subgroup/project": the path of the GitLab project that may deploy. */
  readonly projectPath: string;
  /**
   * Branch names allowed to assume the role. "*" = any branch (used for dev so merge-request jobs can
   * run `cdk diff`). qa and prod are restricted to the default branch.
   */
  readonly allowedBranches: string[];
  readonly roleName: string;
  /** Longest session a job may request. CDK deploys with EKS take 30+ minutes, so we allow 2 hours. */
  readonly maxSessionHours: number;
  /** Qualifier of the CDK bootstrap stack ("hnb659fds" unless you bootstrapped with a custom one). */
  readonly cdkQualifier: string;
  /**
   * An account can hold only ONE OIDC provider per URL. If this account already has one for GitLab
   * (from another project), pass its ARN instead of creating a second.
   */
  readonly existingProviderArn?: string;
}
