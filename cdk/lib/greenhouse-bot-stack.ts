import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';

export interface GreenhouseBotStackProps extends cdk.StackProps {
  scheduleExpression?: string;
  openaiApiKey?: string;
  jobsSearchUrlOneDay?: string;
  resumePath?: string;
  playwrightLayerArn?: string;
  timeout?: number;
  memorySize?: number;
}

export class GreenhouseBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: GreenhouseBotStackProps) {
    super(scope, id, props);

    const scheduleExpression = props?.scheduleExpression || 'cron(0 9 * * ? *)';
    const timeout = props?.timeout || 900;
    const memorySize = props?.memorySize || 2048;
    const jobsSearchUrlOneDay = props?.jobsSearchUrlOneDay || 
      'https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote';

    const resumeBucket = new s3.Bucket(this, 'ResumeBucket', {
      bucketName: `greenhouse-bot-resume-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const contextBucket = new s3.Bucket(this, 'ContextBucket', {
      bucketName: `greenhouse-bot-context-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      lifecycleRules: [{
        id: 'CleanupOldVersions',
        noncurrentVersionExpiration: cdk.Duration.days(30),
      }],
    });

    if (props?.resumePath && fs.existsSync(props.resumePath)) {
      new s3deploy.BucketDeployment(this, 'DeployResume', {
        sources: [s3deploy.Source.asset(path.dirname(props.resumePath), {
          exclude: ['**', '!*.pdf'],
        })],
        destinationBucket: resumeBucket,
        destinationKeyPrefix: 'resume',
      });
    }

    const dlq = new sqs.Queue(this, 'FailedApplicationsDLQ', {
      queueName: `greenhouse-bot-failed-applications-${this.account}-${this.region}`,
      retentionPeriod: cdk.Duration.days(14),
      visibilityTimeout: cdk.Duration.seconds(30),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const playwrightLayer = props?.playwrightLayerArn
      ? lambda.LayerVersion.fromLayerVersionArn(this, 'PlaywrightLayer', props.playwrightLayerArn)
      : undefined;

    const greenhouseBotFunction = new lambda.Function(this, 'GreenhouseBotFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'cdk/dist/index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../'), {
        exclude: [
          'node_modules',
          'cdk/node_modules',
          'cdk/cdk.out',
          '*.ts',
          '*.ts.map',
          '*.d.ts',
          '!dist/**/*',
          '!cdk/dist/**/*',
          '.git',
          '.gitignore',
          '*.md',
          'config.json',
          'failed-*.json',
        ],
      }),
      timeout: cdk.Duration.seconds(timeout),
      memorySize: memorySize,
      environment: {
        JOBS_SEARCH_URL_ONE_DAY: jobsSearchUrlOneDay,
        RESUME_PATH: '/opt/resume/cv.html',
        CONTEXT_BUCKET_NAME: contextBucket.bucketName,
        CONTEXT_S3_KEY: 'browser-context/.browser-context',
        DLQ_URL: dlq.queueUrl,
        NODE_ENV: 'production',
      },
      layers: playwrightLayer ? [playwrightLayer] : undefined,
    });

    resumeBucket.grantRead(greenhouseBotFunction);
    contextBucket.grantReadWrite(greenhouseBotFunction);
    dlq.grantSendMessages(greenhouseBotFunction);

    if (props?.openaiApiKey) {
      const openaiSecret = new secretsmanager.Secret(this, 'OpenAISecret', {
        secretName: 'greenhouse-bot/openai-api-key',
        secretStringValue: cdk.SecretValue.unsafePlainText(props.openaiApiKey),
      });
      openaiSecret.grantRead(greenhouseBotFunction);
      greenhouseBotFunction.addEnvironment('OPENAI_SECRET_ARN', openaiSecret.secretArn);
    }

    const rule = new events.Rule(this, 'GreenhouseBotSchedule', {
      schedule: events.Schedule.expression(scheduleExpression),
      enabled: true,
    });
    rule.addTarget(new targets.LambdaFunction(greenhouseBotFunction));
    greenhouseBotFunction.addPermission('AllowEventBridgeInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: rule.ruleArn,
    });

    new cdk.CfnOutput(this, 'LambdaFunctionArn', { value: greenhouseBotFunction.functionArn });
    new cdk.CfnOutput(this, 'EventBridgeRuleArn', { value: rule.ruleArn });
    new cdk.CfnOutput(this, 'ResumeBucketName', { value: resumeBucket.bucketName });
    new cdk.CfnOutput(this, 'ContextBucketName', { value: contextBucket.bucketName });
    new cdk.CfnOutput(this, 'DLQUrl', { value: dlq.queueUrl });
  }
}

