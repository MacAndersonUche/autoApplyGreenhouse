import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from 'aws-cdk-lib';
import {
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import {
  NodejsFunction,
  OutputFormat,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  RestApi,
  Cors,
  MethodLoggingLevel,
  LambdaIntegration,
} from 'aws-cdk-lib/aws-apigateway';
import {
  Table,
  AttributeType,
  BillingMode,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  RetentionDays,
} from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ApiStackProps extends StackProps {
  openaiApiKey?: string;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: ApiStackProps) {
    super(scope, id, props);

    const failedJobsTable = new Table(this, 'FailedJobsTable', {
      tableName: `greenhouse-bot-failed-jobs-${this.account}-${this.region}`,
      partitionKey: { name: 'id', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    failedJobsTable.addGlobalSecondaryIndex({
      indexName: 'type-timestamp-index',
      partitionKey: { name: 'type', type: AttributeType.STRING },
      sortKey: { name: 'timestamp', type: AttributeType.STRING },
    });

    const runBotFunction = new NodejsFunction(this, 'RunBotFunction', {
      runtime: Runtime.NODEJS_22_X,
      entry: join(__dirname, '../handlers/run-bot.ts'),
      handler: 'handler',
      timeout: Duration.minutes(15),
      memorySize: 2048,
      logRetention: RetentionDays.ONE_WEEK,
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        sourceMap: true,
        minify: true,
        externalModules: [
          'playwright-core',
          '@sparticuz/chromium',
          'chromium-bidi',
          'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
          'chromium-bidi/lib/cjs/cdp/CdpConnection',
        ],
      },
      environment: {
        FAILED_JOBS_TABLE_NAME: failedJobsTable.tableName,
        ...(props?.openaiApiKey && { OPENAI_API_KEY: props.openaiApiKey }),
      },
    });

    const failedJobsFunction = new NodejsFunction(this, 'FailedJobsFunction', {
      runtime: Runtime.NODEJS_22_X,
      entry: join(__dirname, '../handlers/failed-jobs.ts'),
      handler: 'handler',
      timeout: Duration.seconds(30),
      memorySize: 256,
      logRetention: RetentionDays.ONE_WEEK,
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        sourceMap: true,
        minify: true,
        externalModules: [
          'playwright-core',
          '@sparticuz/chromium',
          'chromium-bidi',
          'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
          'chromium-bidi/lib/cjs/cdp/CdpConnection',
        ],
      },
      environment: {
        FAILED_JOBS_TABLE_NAME: failedJobsTable.tableName,
      },
    });

    failedJobsTable.grantReadWriteData(runBotFunction);
    failedJobsTable.grantReadData(failedJobsFunction);

    const api = new RestApi(this, 'Api', {
      restApiName: 'Greenhouse Bot API',
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key'],
      },
      deployOptions: {
        stageName: 'prod',
        loggingLevel: MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
    });

    api.root.addResource('run-bot').addMethod('POST', new LambdaIntegration(runBotFunction));
    api.root.addResource('failed-jobs').addMethod('GET', new LambdaIntegration(failedJobsFunction));

    new CfnOutput(this, 'ApiUrl', {
      value: api.url,
      exportName: 'GreenhouseBotApiUrl',
    });

    new CfnOutput(this, 'FailedJobsTableName', {
      value: failedJobsTable.tableName,
      exportName: 'GreenhouseBotFailedJobsTable',
    });

    new CfnOutput(this, 'RunBotFunctionArn', {
      value: runBotFunction.functionArn,
    });
  }
}
