import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';

export interface GreenhouseBotStackProps extends cdk.StackProps {
  /**
   * Schedule expression for EventBridge rule (cron or rate)
   * Default: Run daily at 9 AM UTC
   */
  scheduleExpression?: string;
  
  /**
   * OpenAI API key (will be stored in Secrets Manager)
   */
  openaiApiKey?: string;
  
  /**
   * Jobs search URL for past day
   * Default: https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote
   */
  jobsSearchUrlOneDay?: string;
  
  /**
   * Path to resume PDF file
   * If provided, will be packaged and deployed with Lambda
   */
  resumePath?: string;
  
  /**
   * Playwright layer ARN (optional)
   * If not provided, will create instructions for manual layer creation
   */
  playwrightLayerArn?: string;
  
  /**
   * Lambda timeout in seconds
   * Default: 900 (15 minutes)
   */
  timeout?: number;
  
  /**
   * Lambda memory size in MB
   * Default: 2048
   */
  memorySize?: number;
}

export class GreenhouseBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: GreenhouseBotStackProps) {
    super(scope, id, props);

    // Default values
    const scheduleExpression = props?.scheduleExpression || 'cron(0 9 * * ? *)'; // Daily at 9 AM UTC
    const timeout = props?.timeout || 900; // 15 minutes
    const memorySize = props?.memorySize || 2048; // 2 GB
    const jobsSearchUrlOneDay = props?.jobsSearchUrlOneDay || 
      'https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote';

    // Create S3 bucket for storing resume PDF
    const resumeBucket = new s3.Bucket(this, 'ResumeBucket', {
      bucketName: `greenhouse-bot-resume-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: false,
    });

    // Create S3 bucket for storing browser context (session data)
    const contextBucket = new s3.Bucket(this, 'ContextBucket', {
      bucketName: `greenhouse-bot-context-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      // Enable versioning to keep history of context files
      versioned: true,
      // Lifecycle rule to clean up old versions after 30 days
      lifecycleRules: [{
        id: 'CleanupOldVersions',
        noncurrentVersionExpiration: cdk.Duration.days(30),
      }],
    });

    // Deploy resume PDF if provided
    if (props?.resumePath && fs.existsSync(props.resumePath)) {
      new s3deploy.BucketDeployment(this, 'DeployResume', {
        sources: [s3deploy.Source.asset(path.dirname(props.resumePath), {
          exclude: ['**', '!*.pdf'],
        })],
        destinationBucket: resumeBucket,
        destinationKeyPrefix: 'resume',
      });
    }

    // Create Lambda layer for Playwright (if ARN not provided, create instructions)
    let playwrightLayer: lambda.ILayerVersion | undefined;
    
    if (props?.playwrightLayerArn) {
      playwrightLayer = lambda.LayerVersion.fromLayerVersionArn(
        this,
        'PlaywrightLayer',
        props.playwrightLayerArn
      );
    } else {
      // Create a placeholder layer ARN for documentation
      // User needs to create this manually
      console.warn(`
        ⚠️  Playwright Layer not provided.
        Please create a Lambda layer with Playwright and Chromium:
        
        1. Create a directory: mkdir -p layer/opt && cd layer/opt
        2. Install Playwright: npm install playwright
        3. Install Chromium: npx playwright install chromium
        4. Create layer: cd .. && zip -r playwright-layer.zip opt/
        5. Upload to AWS Lambda and provide the ARN in stack props
      `);
    }

    // Create Lambda function
    const greenhouseBotFunction = new lambda.Function(this, 'GreenhouseBotFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../dist'), {
        exclude: ['*.ts', '*.ts.map', '*.d.ts'],
      }),
      timeout: cdk.Duration.seconds(timeout),
      memorySize: memorySize,
      environment: {
        JOBS_SEARCH_URL_ONE_DAY: jobsSearchUrlOneDay,
        RESUME_PATH: '/opt/resume/MacAndersonUcheCVAB.pdf',
        CONTEXT_BUCKET_NAME: contextBucket.bucketName,
        CONTEXT_S3_KEY: 'browser-context/.browser-context',
        NODE_ENV: 'production',
        // OpenAI API key will be stored in Secrets Manager (see below)
      },
      layers: playwrightLayer ? [playwrightLayer] : undefined,
      description: 'Greenhouse auto-apply bot Lambda function',
    });

    // Grant Lambda permission to read from resume S3 bucket
    resumeBucket.grantRead(greenhouseBotFunction);

    // Grant Lambda permission to read/write browser context from S3 bucket
    contextBucket.grantReadWrite(greenhouseBotFunction);

    // Store OpenAI API key in Secrets Manager (if provided)
    if (props?.openaiApiKey) {
      const openaiSecret = new secretsmanager.Secret(this, 'OpenAISecret', {
        secretName: 'greenhouse-bot/openai-api-key',
        description: 'OpenAI API key for Greenhouse bot',
        secretStringValue: cdk.SecretValue.unsafePlainText(props.openaiApiKey),
      });

      // Grant Lambda permission to read the secret
      openaiSecret.grantRead(greenhouseBotFunction);
      
      // Add secret ARN to Lambda environment
      greenhouseBotFunction.addEnvironment('OPENAI_SECRET_ARN', openaiSecret.secretArn);
      
      // Note: Lambda code fetches secret at runtime using AWS SDK
    }

    // Create EventBridge rule for scheduled execution
    const rule = new events.Rule(this, 'GreenhouseBotSchedule', {
      description: 'Schedule for Greenhouse auto-apply bot',
      schedule: events.Schedule.expression(scheduleExpression),
      enabled: true,
    });

    // Add Lambda as target
    rule.addTarget(new targets.LambdaFunction(greenhouseBotFunction));

    // Grant EventBridge permission to invoke Lambda
    greenhouseBotFunction.addPermission('AllowEventBridgeInvoke', {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: rule.ruleArn,
    });

    // Outputs
    new cdk.CfnOutput(this, 'LambdaFunctionArn', {
      value: greenhouseBotFunction.functionArn,
      description: 'ARN of the Greenhouse bot Lambda function',
    });

    new cdk.CfnOutput(this, 'EventBridgeRuleArn', {
      value: rule.ruleArn,
      description: 'ARN of the EventBridge rule',
    });

    new cdk.CfnOutput(this, 'ResumeBucketName', {
      value: resumeBucket.bucketName,
      description: 'S3 bucket name for resume storage',
    });

    new cdk.CfnOutput(this, 'ContextBucketName', {
      value: contextBucket.bucketName,
      description: 'S3 bucket name for browser context storage',
    });

    new cdk.CfnOutput(this, 'PlaywrightLayerInstructions', {
      value: playwrightLayer 
        ? 'Playwright layer configured' 
        : 'Please create Playwright layer manually and update stack props',
      description: 'Playwright layer status',
    });
  }
}

