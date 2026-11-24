#!/usr/bin/env bash
# SOURCE this file (do not execute it):    source ci/aws-auth.sh <dev|qa|prod>
#
# Exchanges the job's GitLab ID token for short-lived AWS credentials (OIDC, no stored keys) and exports:
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN   (valid up to 2 hours)
#   CDK_<ENV>_ACCOUNT        derived from the role ARN, read by infra/lib/config/environments.ts
#   AWS_DEFAULT_REGION
#
# Requires:
#   GITLAB_OIDC_TOKEN        provided by `id_tokens:` in .gitlab-ci.yml
#   AWS_ROLE_ARN_<ENV>       a CI/CD variable holding the DeployRoleArn output of orderflow-<env>-gitlab-access
#
# The token is never printed. `set +x` guards against accidental tracing.
set +x

_stage="${1:?usage: source ci/aws-auth.sh <dev|qa|prod>}"
_upper="$(printf '%s' "$_stage" | tr '[:lower:]' '[:upper:]')"
_role_var="AWS_ROLE_ARN_${_upper}"
_role_arn="${!_role_var:-}"

if [ -z "$_role_arn" ]; then
  echo "ERROR: CI/CD variable ${_role_var} is not set (Settings > CI/CD > Variables)." >&2
  return 1
fi
if [ -z "${GITLAB_OIDC_TOKEN:-}" ]; then
  echo "ERROR: GITLAB_OIDC_TOKEN is empty. The job needs an 'id_tokens:' block." >&2
  return 1
fi

export AWS_DEFAULT_REGION="${CDK_DEFAULT_REGION:-us-east-1}"

# assume-role-with-web-identity is an UNSIGNED call: the token itself is the proof of identity.
_creds="$(aws sts assume-role-with-web-identity \
  --no-sign-request \
  --role-arn "$_role_arn" \
  --role-session-name "gitlab-${CI_PIPELINE_ID:-local}-${CI_JOB_ID:-0}" \
  --web-identity-token "$GITLAB_OIDC_TOKEN" \
  --duration-seconds 7200 \
  --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
  --output text)"

read -r AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN <<<"$_creds"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
unset _creds

# arn:aws:iam::<ACCOUNT>:role/<name>  ->  <ACCOUNT>
export "CDK_${_upper}_ACCOUNT=$(printf '%s' "$_role_arn" | cut -d: -f5)"

echo "Assumed $(aws sts get-caller-identity --query Arn --output text)"
