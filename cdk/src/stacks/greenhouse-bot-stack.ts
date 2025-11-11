import {
  Stack,
  StackProps,
  Duration,
  RemovalPolicy,
  CfnOutput,
} from 'aws-cdk-lib';
import {
  Runtime,
  LayerVersion,
} from 'aws-cdk-lib/aws-lambda';
import {
  NodejsFunction,
  OutputFormat,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import {
  Rule,
  Schedule,
} from 'aws-cdk-lib/aws-events';
import {
  LambdaFunction,
} from 'aws-cdk-lib/aws-events-targets';
import {
  ServicePrincipal,
  PolicyStatement,
  Effect,
} from 'aws-cdk-lib/aws-iam';
import {
  Bucket,
} from 'aws-cdk-lib/aws-s3';
import {
  Table,
  AttributeType,
  BillingMode,
  ITable,
} from 'aws-cdk-lib/aws-dynamodb';
import {
  RetentionDays,
} from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface GreenhouseBotStackProps extends StackProps {
  openaiApiKey?: string;
  playwrightLayerArn?: string;
  failedJobsTableName?: string; // Optional: reference to existing DynamoDB table
}

export class GreenhouseBotStack extends Stack {
  constructor(scope: Construct, id: string, props?: GreenhouseBotStackProps) {
    super(scope, id, props);

    const scheduleExpression = 'cron(0 9 * * ? *)';
    const timeout = 900;
    const memorySize = 2048;
    const jobsSearchUrlOneDay = 'https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote';

    let failedJobsTable: ITable;
    let isNewTable = false;
    
    if (props?.failedJobsTableName) {
      failedJobsTable = Table.fromTableName(
        this,
        'FailedJobsTableRef',
        props.failedJobsTableName
      );
    } else {
      const newTable = new Table(this, 'FailedJobsTable', {
        tableName: `greenhouse-bot-failed-jobs-${this.account}-${this.region}`,
        partitionKey: { name: 'id', type: AttributeType.STRING },
        sortKey: { name: 'timestamp', type: AttributeType.STRING },
        billingMode: BillingMode.PAY_PER_REQUEST,
        removalPolicy: RemovalPolicy.DESTROY,
        timeToLiveAttribute: 'ttl',
      });

      newTable.addGlobalSecondaryIndex({
        indexName: 'type-timestamp-index',
        partitionKey: { name: 'type', type: AttributeType.STRING },
        sortKey: { name: 'timestamp', type: AttributeType.STRING },
      });
      
      failedJobsTable = newTable;
      isNewTable = true;
    }

    const contextBucket = new Bucket(this, 'ContextBucket', {
      bucketName: `greenhouse-bot-context-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      lifecycleRules: [{
        id: 'CleanupOldVersions',
        noncurrentVersionExpiration: Duration.days(30),
      }],
    });

    const playwrightLayer = props?.playwrightLayerArn
      ? LayerVersion.fromLayerVersionArn(this, 'PlaywrightLayer', props.playwrightLayerArn)
      : undefined;

    const greenhouseBotFunction = new NodejsFunction(this, 'GreenhouseBotFunction', {
      runtime: Runtime.NODEJS_22_X,
      entry: join(__dirname, '../helpers/index.ts'),
      handler: 'runWithStats',
      timeout: Duration.seconds(timeout),
      memorySize: memorySize,
      logRetention: RetentionDays.ONE_WEEK,
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        sourceMap: true,
        minify: true,
        externalModules: ['playwright'],
      },
      environment: {
        JOBS_SEARCH_URL_ONE_DAY: jobsSearchUrlOneDay,
        CONTEXT_BUCKET_NAME: contextBucket.bucketName,
        CONTEXT_S3_KEY: 'browser-context/.browser-context',
        FAILED_JOBS_TABLE_NAME: failedJobsTable.tableName,
        ...(props?.openaiApiKey && { OPENAI_API_KEY: props.openaiApiKey }),
      },
      layers: playwrightLayer ? [playwrightLayer] : undefined,
    });

    contextBucket.grantReadWrite(greenhouseBotFunction);
    
    if (isNewTable) {
      (failedJobsTable as Table).grantReadWriteData(greenhouseBotFunction);
    } else {
      greenhouseBotFunction.addToRolePolicy(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'dynamodb:PutItem',
            'dynamodb:GetItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
          ],
          resources: [failedJobsTable.tableArn],
        })
      );
    }

    const rule = new Rule(this, 'GreenhouseBotSchedule', {
      schedule: Schedule.expression(scheduleExpression),
      enabled: true,
      description: 'Scheduled execution of Greenhouse bot',
    });
    
    rule.addTarget(new LambdaFunction(greenhouseBotFunction, {
      retryAttempts: 2,
    }));
    
    greenhouseBotFunction.addPermission('AllowEventBridgeInvoke', {
      principal: new ServicePrincipal('events.amazonaws.com'),
      sourceArn: rule.ruleArn,
    });

    new CfnOutput(this, 'LambdaFunctionArn', {
      value: greenhouseBotFunction.functionArn,
      description: 'Scheduled Bot Lambda Function ARN',
    });
    
    new CfnOutput(this, 'EventBridgeRuleArn', {
      value: rule.ruleArn,
      description: 'EventBridge Rule ARN',
    });
    
    new CfnOutput(this, 'ContextBucketName', {
      value: contextBucket.bucketName,
      description: 'S3 Bucket for browser context storage',
    });
    
    new CfnOutput(this, 'FailedJobsTableName', {
      value: failedJobsTable.tableName,
      description: 'DynamoDB table for failed jobs',
    });
  }
}
