/**
 * CONFIG: ENVIRONMENTS + CIDR PLAN  (the single source of truth)
 * ---------------------------------------------------------------------------
 * Every environment (dev, qa, prod) lives in its OWN AWS account.
 *
 * ACCOUNT IDs are read from environment variables so no account number is
 * committed to git:
 *      export CDK_DEV_ACCOUNT=222222222222
 *      export CDK_QA_ACCOUNT=333333333333
 *      export CDK_PROD_ACCOUNT=444444444444
 *
 * Only have ONE account? No problem. When a variable is missing we fall back
 * to CDK_DEFAULT_ACCOUNT (the account your CLI credentials belong to), so
 * `cdk deploy -c stage=dev` works with a single account.
 *
 * CIDR PLAN (read this before changing anything!)
 * ---------------------------------------------------------------------------
 *   Rule 1: CIDRs of VPCs that talk to each other must NEVER overlap.
 *   Rule 2: Keep different environments non-overlapping too, so a future
 *           cross-account Transit Gateway never needs a re-IP.
 *   Rule 3: Do not use 172.20.0.0/16 (EKS Kubernetes service CIDR) or
 *           169.254.0.0/16 (link-local; VPC Lattice uses 169.254.171.0/24).
 *
 *   env   app VPC        eks VPC        client VPC (simulated on-prem)
 *   dev   10.10.0.0/16   10.11.0.0/16   172.16.0.0/16
 *   qa    10.20.0.0/16   10.21.0.0/16   172.17.0.0/16
 *   prod  10.30.0.0/16   10.31.0.0/16   172.18.0.0/16
 *
 *   Pattern: 10.<env*10>.0.0/16 = app, 10.<env*10+1>.0.0/16 = eks.
 *   A /16 has 65,536 addresses. We carve /24 (256) subnets from it.
 */

import * as path from 'path';

export type EnvName = 'dev' | 'qa' | 'prod';

export const PROJECT = 'orderflow';
export const DEFAULT_REGION = process.env.CDK_DEFAULT_REGION ?? 'us-east-1';

/** Absolute path to the python apps folder, independent of where `cdk` is launched from. */
export const APPS_DIR = path.resolve(__dirname, '../../../apps');

export interface EnvironmentConfig {
  readonly name: EnvName;
  readonly account: string | undefined;
  readonly region: string;
  readonly isProd: boolean;
  readonly cidrs: { readonly app: string; readonly eks: string; readonly client: string };
  /** Cost vs. resilience knobs. */
  readonly natGateways: number;
  /** AZ names used by every VPC of this environment. */
  readonly availabilityZones: string[];
  /** Log retention in days. */
  readonly logRetentionDays: number;
  /** Optional e-mail for SNS notifications ('' = none). */
  readonly notificationEmail: string;
}

/** Reads an account id: specific env var first, then the CLI's default account. */
function accountFor(envVar: string): string | undefined {
  return process.env[envVar] ?? process.env.CDK_DEFAULT_ACCOUNT;
}

/**
 * AZ names are mapped per account (your "us-east-1a" may be a different building than mine), but the
 * letters a and b exist in practically every account. Override with ORDERFLOW_AZ_SUFFIXES="a,c" if needed.
 */
function azsFor(region: string): string[] {
  return (process.env.ORDERFLOW_AZ_SUFFIXES ?? 'a,b')
    .split(',')
    .map((suffix) => `${region}${suffix.trim()}`);
}

export const ENVIRONMENTS: Record<EnvName, EnvironmentConfig> = {
  dev: {
    name: 'dev',
    account: accountFor('CDK_DEV_ACCOUNT'),
    region: DEFAULT_REGION,
    isProd: false,
    cidrs: { app: '10.10.0.0/16', eks: '10.11.0.0/16', client: '172.16.0.0/16' },
    natGateways: 1, // ONE shared NAT: cheap, but a single point of failure (fine for dev)
    availabilityZones: azsFor(DEFAULT_REGION),
    logRetentionDays: 7,
    notificationEmail: process.env.ORDERFLOW_NOTIFY_EMAIL ?? '',
  },
  qa: {
    name: 'qa',
    account: accountFor('CDK_QA_ACCOUNT'),
    region: DEFAULT_REGION,
    isProd: false,
    cidrs: { app: '10.20.0.0/16', eks: '10.21.0.0/16', client: '172.17.0.0/16' },
    natGateways: 1,
    availabilityZones: azsFor(DEFAULT_REGION),
    logRetentionDays: 14,
    notificationEmail: process.env.ORDERFLOW_NOTIFY_EMAIL ?? '',
  },
  prod: {
    name: 'prod',
    account: accountFor('CDK_PROD_ACCOUNT'),
    region: DEFAULT_REGION,
    isProd: true,
    cidrs: { app: '10.30.0.0/16', eks: '10.31.0.0/16', client: '172.18.0.0/16' },
    natGateways: 2, // one NAT per AZ: an AZ outage does not kill egress
    availabilityZones: azsFor(DEFAULT_REGION),
    logRetentionDays: 90,
    notificationEmail: process.env.ORDERFLOW_NOTIFY_EMAIL ?? '',
  },
};

/** Name helper so every resource name is consistent: orderflow-dev-orders */
export function resourceName(env: EnvironmentConfig, suffix: string): string {
  return `${PROJECT}-${env.name}-${suffix}`;
}
