#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { GreenhouseBotStack } from '../lib/greenhouse-bot-stack';

const app = new cdk.App();

new GreenhouseBotStack(app, 'GreenhouseBotStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  openaiApiKey: process.env.OPENAI_API_KEY,
  jobsSearchUrlOneDay: 'https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote',
  scheduleExpression: 'cron(0 9 * * ? *)',
  timeout: 900,
  memorySize: 2048,
});
