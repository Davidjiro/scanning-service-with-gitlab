# bin/  -  the app entry point

`app.ts` is the file the CDK CLI executes (`"app"` in `../cdk.json`). It is where all stacks are joined.

## What it does, in order
1. Creates the `cdk.App`.
2. **Pre-seeds the Availability Zone context** for each account from `config/environments.ts`, so synthesis
   makes no AWS API calls (so the GitLab `validate` job needs no credentials).
3. Reads the context flags `mode` and `stage`:
   - `direct` (default): builds ONE `AppStage` for the environment named by `-c stage=` (default `dev`).
   - `gitlab-access`: builds the small `GitlabAccessStack` (OIDC provider + deploy role) for that environment.

```bash
npx cdk deploy "dev/*"                                                       # direct, dev
npx cdk deploy "qa/*" -c stage=qa                                            # direct, qa
npx cdk deploy orderflow-dev-gitlab-access -c mode=gitlab-access -c stage=dev      # one-time, per account
```

## Why two modes?
`direct` is what GitLab CI runs (`.gitlab-ci.yml`) and what you run during development, so a manual dev deploy tests
exactly what the pipeline later promotes. `gitlab-access` exists separately because the pipeline cannot create the
role it needs in order to run: a human deploys it once per account, then GitLab takes over.
