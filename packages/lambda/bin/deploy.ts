#!/usr/bin/env node
/**
 * Deployment script with example configuration
 * 
 * Usage:
 *   npx ts-node bin/deploy.ts
 * 
 * Or set environment variables:
 *   OPENAI_API_KEY=your_key npx ts-node bin/deploy.ts
 */

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GreenhouseBotStack } from '../lib/greenhouse-bot-stack';
import * as path from 'path';
import * as fs from 'fs';

const app = new cdk.App();

// Get configuration from environment variables or defaults
const openaiApiKey = process.env.OPENAI_API_KEY;
const jobsSearchUrlOneDay = process.env.JOBS_SEARCH_URL_ONE_DAY || 
  'https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote';
const scheduleExpression = process.env.SCHEDULE_EXPRESSION || 'cron(0 9 * * ? *)'; // Daily at 9 AM UTC
const playwrightLayerArn = process.env.PLAYWRIGHT_LAYER_ARN;

// Try to find resume PDF in common locations
const resumePaths = [
  path.join(__dirname, '../../..', 'MacAndersonUcheCVAB.pdf'),
  path.join(__dirname, '..', 'resume.pdf'),
  process.env.RESUME_PATH,
].filter(Boolean) as string[];

let resumePath: string | undefined;
for (const candidatePath of resumePaths) {
  if (fs.existsSync(candidatePath)) {
    resumePath = candidatePath;
    break;
  }
}

if (!resumePath) {
  console.warn('⚠️  Resume PDF not found. Please provide RESUME_PATH environment variable.');
}

new GreenhouseBotStack(app, 'GreenhouseBotStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
    region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
  },
  description: 'Stack for Greenhouse auto-apply bot Lambda function',
  openaiApiKey: openaiApiKey,
  jobsSearchUrlOneDay: jobsSearchUrlOneDay,
  scheduleExpression: scheduleExpression,
  resumePath: resumePath,
  playwrightLayerArn: playwrightLayerArn,
  timeout: parseInt(process.env.LAMBDA_TIMEOUT || '900', 10),
  memorySize: parseInt(process.env.LAMBDA_MEMORY || '2048', 10),
});

app.synth();

