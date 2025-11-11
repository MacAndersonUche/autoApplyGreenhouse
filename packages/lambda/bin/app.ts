#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GreenhouseBotStack } from '../lib/greenhouse-bot-stack';

const app = new cdk.App();

// Get configuration from environment variables
const openaiApiKey = process.env.OPENAI_API_KEY;
const jobsSearchUrlOneDay = process.env.JOBS_SEARCH_URL_ONE_DAY;
const scheduleExpression = process.env.SCHEDULE_EXPRESSION;
const playwrightLayerArn = process.env.PLAYWRIGHT_LAYER_ARN;

new GreenhouseBotStack(app, 'GreenhouseBotStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Stack for Greenhouse auto-apply bot Lambda function',
  openaiApiKey: openaiApiKey,
  jobsSearchUrlOneDay: jobsSearchUrlOneDay,
  scheduleExpression: scheduleExpression,
  playwrightLayerArn: playwrightLayerArn,
});
