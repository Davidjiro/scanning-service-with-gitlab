/**
 * CONSTRUCT (L3): LambdaRestApi  (Amazon API Gateway, REST API)
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS
 *   A REGIONAL REST API in front of one Lambda (proxy integration) with:
 *     POST /orders             (request body validated by API Gateway BEFORE Lambda runs)
 *     GET  /orders             (query by status)
 *     GET  /orders/{orderId}
 *   plus a deployment stage with throttling and JSON access logs.
 *
 * KEY CONCEPTS
 *   REST API vs HTTP API   REST API: more features (usage plans/API keys, request validation,
 *                          WAF, caching, private endpoints) and costs more. HTTP API: cheaper,
 *                          faster, simpler (JWT auth built in). Know when to pick which.
 *   Endpoint types         Regional (default, what we use) | Edge-optimised (CloudFront) | Private (VPC only).
 *   Lambda proxy           API Gateway forwards the raw request; Lambda must return
 *                          {statusCode, headers, body}. Non-proxy uses mapping templates (VTL).
 *   Stage                  A named, deployed snapshot (e.g. "v1"). Throttling and logging are per stage.
 *   Throttling             Token bucket: `rate` = steady requests/second, `burst` = bucket size.
 *                          Exceeding it returns HTTP 429.
 *   Request validator      Rejects malformed bodies with 400 at the edge: you do not pay for a Lambda
 *                          invocation on garbage input.
 *   Authorisation          Not enabled in this version (see "Production hardening" in the README). Options: IAM (SigV4), Cognito authoriser,
 *                          Lambda (custom) authoriser, API keys + usage plans (rate limiting, NOT auth).
 *
 * PERMISSIONS: API Gateway needs permission to invoke the Lambda. CDK adds a Lambda resource-based
 * policy ("lambda:InvokeFunction" from the API's ARN) when you call `new LambdaIntegration(fn)`.
 *
 * DEPENDENCIES: the Lambda must exist first.
 */
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { LambdaRestApiProps } from '../props/compute-props';

export class LambdaRestApi extends Construct {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: LambdaRestApiProps) {
    super(scope, id);

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.api = new apigw.RestApi(this, 'Api', {
      restApiName: props.apiName,
      description: 'Order API: API Gateway -> Lambda -> DynamoDB + SNS',
      endpointTypes: [apigw.EndpointType.REGIONAL],
      deployOptions: {
        stageName: props.stageName,
        throttlingRateLimit: props.throttleRateLimit,
        throttlingBurstLimit: props.throttleBurstLimit,
        accessLogDestination: new apigw.LogGroupLogDestination(accessLogs),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields(),
        tracingEnabled: true,
      },
    });

    const integration = new apigw.LambdaIntegration(props.handler); // proxy integration by default

    // ---- Request validation: model = JSON Schema of the POST body.
    const orderModel = this.api.addModel('OrderModel', {
      contentType: 'application/json',
      modelName: 'OrderRequest',
      schema: {
        schema: apigw.JsonSchemaVersion.DRAFT4,
        type: apigw.JsonSchemaType.OBJECT,
        required: ['item', 'quantity'],
        properties: {
          item: { type: apigw.JsonSchemaType.STRING, minLength: 1 },
          quantity: { type: apigw.JsonSchemaType.INTEGER, minimum: 1 },
        },
        additionalProperties: false,
      },
    });
    const bodyValidator = this.api.addRequestValidator('BodyValidator', {
      validateRequestBody: true,
      validateRequestParameters: false,
    });

    // ---- Resources (URL paths) and methods.
    const orders = this.api.root.addResource('orders');
    orders.addMethod('POST', integration, {
      requestValidator: bodyValidator,
      requestModels: { 'application/json': orderModel },
    });
    orders.addMethod('GET', integration);
    orders.addResource('{orderId}').addMethod('GET', integration);
  }
}
