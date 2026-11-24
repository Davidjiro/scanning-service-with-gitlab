# ci/  -  how the GitLab pipeline talks to AWS

The pipeline definition is [`../.gitlab-ci.yml`](../.gitlab-ci.yml) (GitLab requires it at the repo root).
This directory holds the two scripts it calls.

| File | Used by | Purpose |
|------|---------|---------|
| `aws-auth.sh` | every job that touches AWS (`source ci/aws-auth.sh <env>`) | trades the job's GitLab ID token for temporary AWS credentials |
| `install-tools.sh` | `before_script` of AWS jobs | installs AWS CLI v2 (and the Docker CLI for deploy jobs) on top of `node:22-bookworm` |

## The pipeline

```
 merge request   validate ─► diff-dev (read-only `cdk diff`)
 default branch  validate ─► deploy-dev ─► test-dev ─► [manual] deploy-qa ─► test-qa ─► [manual] deploy-prod ─► verify-prod
```

| Job | Needs AWS? | What it does |
|-----|-----------|--------------|
| `validate` | no | `tsc`, Python compile check, offline `cdk synth` for dev, qa and prod |
| `diff-dev` | yes (dev) | shows what a merge request would change; failure does not block |
| `deploy-<env>` | yes | `cdk deploy "<env>/*"`; builds the Docker image (docker:dind), publishes assets, runs CloudFormation |
| `test-dev`, `test-qa` | yes | `scripts/smoke-test.sh`: creates orders and checks the whole flow |
| `verify-prod` | yes (prod) | `scripts/health-check.sh`: read-only (no orders are created in production) |

`deploy-qa` and `deploy-prod` use `when: manual` + `allow_failure: false`: the pipeline **stops** there until a person
clicks Run. Protect the `qa` / `prod` *environments* in GitLab to restrict who may.

## Authentication, step by step (OIDC, no stored keys)

1. `id_tokens:` in the job asks GitLab to sign a JWT for **this job**. It contains `aud` (audience), and
   `sub = project_path:<group>/<project>:ref_type:branch:ref:<branch>`. It expires with the job.
2. `aws-auth.sh` calls `aws sts assume-role-with-web-identity` with that token and the role ARN from the
   `AWS_ROLE_ARN_<ENV>` variable. The call is unsigned: the token is the proof.
3. AWS fetches GitLab's public signing keys (via the IAM OIDC provider), verifies the signature, then evaluates the
   role's **trust policy**: `aud` must equal the registered audience and `sub` must match the allowed project + branch.
4. STS returns temporary credentials (up to 2 hours). The script exports them and also exports `CDK_<ENV>_ACCOUNT`
   (taken from the role ARN) so the CDK config targets the right account.
5. `cdk deploy` uses those credentials only to **assume the CDK bootstrap roles** in the account
   (`cdk-hnb659fds-deploy-role`, `...-file-publishing-role`, `...-image-publishing-role`). CloudFormation then runs as the
   `cfn-exec` role. The GitLab role itself cannot create resources.

The role and provider are created by `infra/lib/constructs/gitlab-oidc-role.ts` (read its header comment).

## Why this is better than access keys in CI variables
| Access keys | OIDC |
|-------------|------|
| long-lived secret stored in GitLab | nothing secret stored |
| any job (or anyone with the variable) can use it | only this project, only allowed branches |
| must be rotated by hand | credentials expire in ≤ 2 hours |
| usually over-privileged | role may only assume the CDK bootstrap roles |

## Runner requirements
- Docker executor with ability to start the `docker:27-dind` service (privileged). GitLab.com SaaS runners work.
- Default tag `saas-linux-small-arm64` (native ARM, because our images are `linux/arm64`).
- Scripts need **bash** (the `node:22-bookworm` image has it; the Docker executor uses it automatically).

## Customising for self-managed GitLab
1. `export GITLAB_HOST=gitlab.mycompany.com` before deploying the `gitlab-access` stacks (provider URL and conditions follow).
2. Change `aud: https://gitlab.com` in `.gitlab-ci.yml` to `https://gitlab.mycompany.com`.
3. Replace the runner `tags:` with your own.
