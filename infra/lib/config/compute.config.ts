/**
 * CONFIG: COMPUTE  ->  fills the props in `props/compute-props.ts`
 *
 * Each function returns a props object WITHOUT the "live" references (VPC, table, topic...).
 * Those are objects created by other constructs, so the STACK adds them when it calls the
 * construct:   new PythonLambda(this, 'X', { ...apiHandlerConfig(env), vpc: network.appVpc.vpc })
 */
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { APPS_DIR, EnvironmentConfig, resourceName } from './environments';
import { PythonLambdaProps, FargateAlbServiceProps } from '../props/compute-props';
import { WORKER_TIMEOUT_SECONDS } from './data.config';

/** The port the container listens on. Also the target group port and SG rule. */
export const CONTAINER_PORT = 8080;

/** The port the ALB LISTENER accepts (what clients and VPC Lattice connect to). */
export const ALB_LISTENER_PORT = 80;

type LambdaStaticProps = Omit<PythonLambdaProps, 'environment' | 'vpc' | 'vpcSubnets' | 'securityGroups'>;

export function apiHandlerConfig(env: EnvironmentConfig): LambdaStaticProps {
  return {
    functionName: resourceName(env, 'api-handler'),
    codePath: path.join(APPS_DIR, 'lambdas/api_handler'),
    handler: 'handler.main',
    memorySize: 256,
    timeout: cdk.Duration.seconds(10), // must be < API Gateway's 29 s integration timeout
    logRetentionDays: env.logRetentionDays,
  };
}

export function validateConfig(env: EnvironmentConfig): LambdaStaticProps {
  return {
    functionName: resourceName(env, 'validate'),
    codePath: path.join(APPS_DIR, 'lambdas/validate'),
    handler: 'handler.main',
    memorySize: 128,
    timeout: cdk.Duration.seconds(5),
    logRetentionDays: env.logRetentionDays,
  };
}

export function workerConfig(env: EnvironmentConfig): LambdaStaticProps {
  return {
    functionName: resourceName(env, 'worker'),
    codePath: path.join(APPS_DIR, 'lambdas/worker'),
    handler: 'handler.main',
    memorySize: 128,
    timeout: cdk.Duration.seconds(WORKER_TIMEOUT_SECONDS),
    logRetentionDays: env.logRetentionDays,
  };
}

export function apiGatewayConfig(env: EnvironmentConfig) {
  return {
    apiName: resourceName(env, 'orders-api'),
    stageName: 'v1',
    throttleRateLimit: env.isProd ? 100 : 10, // requests / second
    throttleBurstLimit: env.isProd ? 200 : 20,
  };
}

export function stateMachineConfig(env: EnvironmentConfig) {
  return {
    stateMachineName: resourceName(env, 'order-workflow'),
    logRetentionDays: env.logRetentionDays,
  };
}

type FargateStaticProps = Omit<FargateAlbServiceProps, 'vpc' | 'environment' | 'allowedIngressCidrs'>;

/** Public service: reachable from the internet through an internet-facing ALB. */
export function webServiceConfig(env: EnvironmentConfig): FargateStaticProps {
  return {
    serviceName: resourceName(env, 'web'),
    dockerContextPath: path.join(APPS_DIR, 'service'),
    containerPort: CONTAINER_PORT,
    cpu: 256, // 0.25 vCPU
    memoryMiB: 512,
    desiredCount: env.isProd ? 2 : 1,
    internetFacing: true,
    healthCheckPath: '/health',
    logRetentionDays: env.logRetentionDays,
  };
}

/** Internal service: private ALB, reached over peering / Transit Gateway / VPC Lattice. */
export function internalServiceConfig(env: EnvironmentConfig): FargateStaticProps {
  return {
    serviceName: resourceName(env, 'internal'),
    dockerContextPath: path.join(APPS_DIR, 'service'),
    containerPort: CONTAINER_PORT,
    cpu: 256,
    memoryMiB: 512,
    desiredCount: env.isProd ? 2 : 1,
    internetFacing: false,
    healthCheckPath: '/health',
    logRetentionDays: env.logRetentionDays,
  };
}
