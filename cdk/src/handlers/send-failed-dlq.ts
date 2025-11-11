// Lambda handler - imports bot from bundled source
// Dynamic import resolved at runtime when code is bundled in Lambda
const loadBotModule = async () => {
  // @ts-expect-error - Dynamic import path resolved at runtime in Lambda bundle
  const module = await import('../../../dist/index.js');
  return module.GreenhouseAutoApplyBot;
};

// AWS Lambda and SDK types - available at runtime in Lambda environment
import type { EventBridgeEvent } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
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
  } catch (error) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
    if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
      const message = err.message || String(error);
      console.warn('⚠️  Failed to download browser context:', message);
    }
  }
}

interface FailedJob {
  jobTitle: string;
  url: string;
  timestamp: string;
  reason: string;
}

async function sendFailedJobsToDLQ(failedJobs: FailedJob[]): Promise<void> {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to send jobs to DLQ:', message);
  }
}

export const handler = async (event: EventBridgeEvent<'Scheduled Event', unknown>) => {
  console.log('🚀 Lambda triggered by EventBridge');

  await downloadContextFromS3();

  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️  OPENAI_API_KEY not found in environment variables. Text box auto-fill will be disabled.');
  }

  process.env.BROWSER_CONTEXT_PATH = '/tmp/.browser-context';

  try {
    const BotClass = await loadBotModule();
    const bot = new BotClass();
    
    // Use runWithStats to get failed jobs in a type-safe way
    const stats = await bot.runWithStats();
    
    // Send failed jobs to DLQ
    if (stats.failedJobs.length > 0) {
      const allFailed = stats.failedJobs.map((job: FailedJob) => ({
        ...job,
        type: 'application' as const, // runWithStats doesn't distinguish submission vs application
      }));
      await sendFailedJobsToDLQ(allFailed);
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Bot execution completed',
        jobsFound: stats.jobsFound,
        jobsApplied: stats.jobsApplied,
        jobsFailed: stats.jobsFailed,
        failedJobsCount: stats.failedJobs.length,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('❌ Lambda execution error:', error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Bot execution failed',
        error: errorMessage,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

