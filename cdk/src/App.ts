#!/usr/bin/env node
import 'source-map-support/register';
import { App } from 'aws-cdk-lib';
import { ApiStack } from './stacks/api-stack';

const app = new App();

new ApiStack(app, 'GreenhouseBotApiStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-north-1',
  },
  openaiApiKey: process.env.OPENAI_API_KEY,
});
