import { GreenhouseAutoApplyBot } from '@greenhouse-bot/core';
import type { EventBridgeEvent } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Lambda handler for EventBridge cron job
 * Runs the bot in headless mode with JOBS_SEARCH_URL_ONE_DAY
 */
/**
 * Download browser context from S3 to local /tmp directory
 */
async function downloadContextFromS3(): Promise<void> {
  const bucketName = process.env.CONTEXT_BUCKET_NAME;
  const s3Key = process.env.CONTEXT_S3_KEY || 'browser-context/.browser-context';
  const localPath = '/tmp/.browser-context';

  if (!bucketName) {
    console.log('⚠️  CONTEXT_BUCKET_NAME not set, skipping context download');
    return;
  }

  try {
    const s3Client = new S3Client({});
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    const response = await s3Client.send(command);
    const body = await response.Body?.transformToByteArray();
    
    if (body) {
      // Ensure directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(localPath, Buffer.from(body));
      console.log(`✅ Downloaded browser context from S3: s3://${bucketName}/${s3Key}`);
    }
  } catch (error: any) {
    if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
      console.log('ℹ️  No existing browser context found in S3, will create new session');
    } else {
      console.warn('⚠️  Failed to download browser context from S3:', error.message);
    }
  }
}

/**
 * Upload browser context from local /tmp directory to S3
 */
async function uploadContextToS3(): Promise<void> {
  const bucketName = process.env.CONTEXT_BUCKET_NAME;
  const s3Key = process.env.CONTEXT_S3_KEY || 'browser-context/.browser-context';
  const localPath = '/tmp/.browser-context';

  if (!bucketName) {
    console.log('⚠️  CONTEXT_BUCKET_NAME not set, skipping context upload');
    return;
  }

  try {
    if (!fs.existsSync(localPath)) {
      console.log('ℹ️  No browser context file to upload');
      return;
    }

    const s3Client = new S3Client({});
    const fileContent = fs.readFileSync(localPath);
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: fileContent,
      ContentType: 'application/json',
    });

    await s3Client.send(command);
    console.log(`✅ Uploaded browser context to S3: s3://${bucketName}/${s3Key}`);
  } catch (error: any) {
    console.error('❌ Failed to upload browser context to S3:', error.message);
    // Don't throw - we don't want to fail the Lambda if upload fails
  }
}

export const handler = async (event: EventBridgeEvent<'Scheduled Event', any>) => {
  console.log('🚀 Lambda triggered by EventBridge:', JSON.stringify(event, null, 2));

  // Download browser context from S3 before starting
  await downloadContextFromS3();

  // Fetch OpenAI API key from Secrets Manager if secret ARN is provided
  let openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey && process.env.OPENAI_SECRET_ARN) {
    try {
      const secretsClient = new SecretsManagerClient({});
      const command = new GetSecretValueCommand({
        SecretId: process.env.OPENAI_SECRET_ARN,
      });
      const response = await secretsClient.send(command);
      openaiApiKey = response.SecretString || '';
      console.log('✅ Retrieved OpenAI API key from Secrets Manager');
    } catch (error) {
      console.error('❌ Failed to retrieve OpenAI API key from Secrets Manager:', error);
      // Continue without OpenAI (form filling will be disabled)
    }
  }

  const bot = new GreenhouseAutoApplyBot({
    headless: true,
    jobsSearchUrl: process.env.JOBS_SEARCH_URL_ONE_DAY || 'https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote',
    contextPath: '/tmp/.browser-context', // Lambda uses /tmp for writable storage
    resumePath: process.env.RESUME_PATH || '/opt/resume/MacAndersonUcheCVAB.pdf',
    openaiApiKey: openaiApiKey,
  });

  // Note: In Lambda, you'll need to:
  // 1. Package the resume PDF as a Lambda layer or include it in the deployment
  // 2. Install Playwright browsers in the Lambda layer (playwright install chromium)
  // 3. Set PLAYWRIGHT_BROWSERS_PATH environment variable if using a layer

  try {
    await bot.run();
    
    // Upload browser context to S3 after successful execution
    await uploadContextToS3();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Bot execution completed successfully',
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('❌ Lambda execution error:', error);
    
    // Try to upload context even on error (in case session was updated)
    try {
      await uploadContextToS3();
    } catch (uploadError) {
      console.warn('⚠️  Failed to upload context after error:', uploadError);
    }
    
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

