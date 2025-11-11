import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from 'aws-cdk-lib';
import {
  Function,
  Runtime,
  Code,
} from 'aws-cdk-lib/aws-lambda';
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
  LogGroup,
  RetentionDays,
} from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ApiStackProps extends StackProps {
  openaiApiKey?: string;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: ApiStackProps) {
    super(scope, id, props);

    const codeAsset = Code.fromAsset(path.join(__dirname, '../../'), {
      exclude: [
        'node_modules',
        'cdk/node_modules',
        'cdk/cdk.out',
        '*.ts',
        '*.ts.map',
        '*.d.ts',
        '!dist/**/*',
        '.git',
        '.gitignore',
        '*.md',
        'failed-*.json',
        'frontend/**/*',
        'src/**/*',
      ],
    });

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

    const logGroup = new LogGroup(this, 'ApiLogGroup', {
      logGroupName: `/aws/lambda/greenhouse-bot-api`,
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const runBotFunction = new Function(this, 'RunBotFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'dist/api/run-bot.handler',
      code: codeAsset,
      timeout: Duration.minutes(15),
      memorySize: 2048,
      logGroup,
      environment: {
        FAILED_JOBS_TABLE_NAME: failedJobsTable.tableName,
        ...(props?.openaiApiKey && { OPENAI_API_KEY: props.openaiApiKey }),
      },
    });

    const failedJobsFunction = new Function(this, 'FailedJobsFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'dist/api/failed-jobs.handler',
      code: codeAsset,
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup,
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
