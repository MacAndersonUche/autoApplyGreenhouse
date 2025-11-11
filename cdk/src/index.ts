// Lambda handler - imports bot from bundled source
// Import the type from the declaration file
import type { GreenhouseAutoApplyBot } from './bot-types';

// Runtime import - will be available when code is bundled in Lambda
// Using a function that will be resolved at runtime
const loadBotModule = async (): Promise<typeof GreenhouseAutoApplyBot> => {
  // Dynamic import using string literal - TypeScript will allow this
  // The path will resolve correctly at runtime in the Lambda bundle
  const modulePath = '../../../dist/index.js' as string;
  const module = await import(modulePath) as { GreenhouseAutoApplyBot: typeof GreenhouseAutoApplyBot };
  return module.GreenhouseAutoApplyBot;
};

// AWS Lambda and SDK types - available at runtime in Lambda environment
import type { EventBridgeEvent } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import * as fs from 'fs';
import * as path from 'path';

async function downloadContextFromS3(): Promise<void> {
  const bucketName = process.env.CONTEXT_BUCKET_NAME;
  const s3Key = process.env.CONTEXT_S3_KEY || 'browser-context/.browser-context';
  const localPath = '/tmp/.browser-context';

  if (!bucketName) return;

  try {
    const s3Client = new S3Client({});
    const response = await s3Client.send(new GetObjectCommand({ Bucket: bucketName, Key: s3Key }));
    const body = await response.Body?.transformToByteArray();
    
    if (body) {
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(localPath, Buffer.from(body));
      console.log(`✅ Downloaded browser context from S3`);
    }
  } catch (error: any) {
    if (error.name !== 'NoSuchKey' && error.$metadata?.httpStatusCode !== 404) {
      console.warn('⚠️  Failed to download browser context:', error.message);
    }
  }
}

async function uploadContextToS3(): Promise<void> {
  const bucketName = process.env.CONTEXT_BUCKET_NAME;
  const s3Key = process.env.CONTEXT_S3_KEY || 'browser-context/.browser-context';
  const localPath = '/tmp/.browser-context';

  if (!bucketName || !fs.existsSync(localPath)) return;

  try {
    const s3Client = new S3Client({});
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: fs.readFileSync(localPath),
      ContentType: 'application/json',
    }));
    console.log(`✅ Uploaded browser context to S3`);
  } catch (error: any) {
    console.error('❌ Failed to upload browser context:', error.message);
  }
}

async function sendFailedJobsToDLQ(failedJobs: Array<{ jobTitle: string; url: string; timestamp: string; reason: string }>): Promise<void> {
  const dlqUrl = process.env.DLQ_URL;
  if (!dlqUrl) return;

  try {
    const sqsClient = new SQSClient({});
    for (const job of failedJobs) {
      await sqsClient.send(new SendMessageCommand({
        QueueUrl: dlqUrl,
        MessageBody: JSON.stringify({ ...job, lambdaExecutionTime: new Date().toISOString() }),
      }));
    }
    console.log(`✅ Sent ${failedJobs.length} failed job(s) to DLQ`);
  } catch (error: any) {
    console.error('❌ Failed to send jobs to DLQ:', error.message);
  }
}

export const handler = async (event: EventBridgeEvent<'Scheduled Event', any, any>) => {
  console.log('🚀 Lambda triggered by EventBridge');

  await downloadContextFromS3();

  let openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey && process.env.OPENAI_SECRET_ARN) {
    try {
      const secretsClient = new SecretsManagerClient({});
      const response = await secretsClient.send(new GetSecretValueCommand({
        SecretId: process.env.OPENAI_SECRET_ARN,
      }));
      openaiApiKey = response.SecretString || '';
    } catch (error) {
      console.error('❌ Failed to retrieve OpenAI API key:', error);
    }
  }

  if (openaiApiKey) {
    process.env.OPENAI_API_KEY = openaiApiKey;
  }

  // Set context path for Lambda
  process.env.BROWSER_CONTEXT_PATH = '/tmp/.browser-context';

  // Load bot class dynamically (works at runtime when bundled)
  const BotClass = await loadBotModule();
  const bot = new BotClass();

  try {
    await bot.run();
    await uploadContextToS3();
    
    // Access failed jobs through internal properties (they're private but accessible at runtime)
    const botInternal = bot as any;
    const failedSubmissions = botInternal.failedSubmissions || [];
    const failedApplications = botInternal.failedApplications || [];
    const allFailed = [
      ...failedSubmissions.map((f: { jobTitle: string; url: string; timestamp: string; reason: string }) => ({ ...f, type: 'submission' })),
      ...failedApplications.map((f: { jobTitle: string; url: string; timestamp: string; reason: string }) => ({ ...f, type: 'application' })),
    ];
    
    if (allFailed.length > 0) {
      await sendFailedJobsToDLQ(allFailed);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Bot execution completed',
        failedJobsCount: allFailed.length,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('❌ Lambda execution error:', error);
    await uploadContextToS3();
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Bot execution failed',
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

