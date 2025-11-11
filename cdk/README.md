# Lambda Package

This package contains the AWS Lambda function for running the Greenhouse auto-apply bot on a schedule via EventBridge.

## CDK Deployment

This package includes AWS CDK infrastructure code for easy deployment.

### Prerequisites

1. Install AWS CDK CLI globally (if not already installed):
```bash
npm install -g aws-cdk
```

2. Build the lambda package:
```bash
npm run build:lambda
```

4. Install dependencies:
```bash
npm install
```

5. Bootstrap CDK (first time only):
```bash
npm run cdk:bootstrap
```

### Deployment

#### Option 1: Using the deployment script (Recommended)

1. Set environment variables:
```bash
export OPENAI_API_KEY=your_openai_api_key
export AWS_ACCOUNT_ID=your_account_id
export AWS_REGION=us-east-1
export RESUME_PATH=../../../MacAndersonUcheCVAB.pdf  # Path to resume PDF
export PLAYWRIGHT_LAYER_ARN=arn:aws:lambda:region:account:layer:playwright:1  # Optional
```

2. Deploy:
```bash
npx ts-node bin/deploy.ts
npm run cdk:deploy
```

#### Option 2: Using CDK directly

1. Review and modify `bin/app.ts` with your configuration

2. Synthesize CloudFormation template:
```bash
npm run cdk:synth
```

3. Preview changes:
```bash
npm run cdk:diff
```

4. Deploy:
```bash
npm run cdk:deploy
```

### Playwright Layer Setup

Playwright requires Chromium to be installed. You have two options:

#### Option 1: Create Layer Manually (Recommended)

1. Create a directory structure:
```bash
mkdir -p playwright-layer/opt
cd playwright-layer/opt
npm init -y
npm install playwright
npx playwright install chromium
cd ..
zip -r playwright-layer.zip opt/
```

2. Upload to AWS Lambda:
   - Go to AWS Lambda Console
   - Create a new layer
   - Upload `playwright-layer.zip`
   - Note the ARN

3. Provide the ARN when deploying:
```bash
export PLAYWRIGHT_LAYER_ARN=arn:aws:lambda:region:account:layer:playwright:1
```

#### Option 2: Use CDK to Create Layer (Advanced)

You can extend the CDK stack to create the layer automatically, but it requires building the layer in a Docker container or EC2 instance.

### Configuration

The stack accepts the following configuration options:

- `scheduleExpression`: EventBridge cron expression (default: `cron(0 9 * * ? *)` - daily at 9 AM UTC)
- `openaiApiKey`: OpenAI API key (set as environment variable during deployment)
- `jobsSearchUrlOneDay`: URL for jobs posted in the past day
- `resumePath`: Path to resume PDF file
- `playwrightLayerArn`: ARN of Playwright Lambda layer
- `timeout`: Lambda timeout in seconds (default: 900)
- `memorySize`: Lambda memory in MB (default: 2048)

### Environment Variables

The Lambda function uses these environment variables:

- `JOBS_SEARCH_URL_ONE_DAY`: Jobs search URL (set by CDK)
- `RESUME_PATH`: Path to resume HTML file (default: `/opt/resume/cv.html`)
- `OPENAI_API_KEY`: OpenAI API key (set as environment variable during deployment)

### Manual Lambda Package Deployment

If you prefer to deploy manually without CDK:

1. Package the function:
```bash
npm run package
```

2. Upload `function.zip` to AWS Lambda

3. Configure environment variables manually

4. Create EventBridge rule manually

### Useful Commands

- `npm run cdk:synth` - Synthesize CloudFormation template
- `npm run cdk:diff` - Compare deployed stack with current state
- `npm run cdk:deploy` - Deploy stack to AWS
- `npm run cdk:destroy` - Destroy the stack
- `npm run build` - Compile TypeScript
- `npm run package` - Create deployment package

### Stack Outputs

After deployment, the stack outputs:

- `LambdaFunctionArn`: ARN of the Lambda function
- `EventBridgeRuleArn`: ARN of the EventBridge rule
- `ResumeBucketName`: S3 bucket name for resume storage
- `PlaywrightLayerInstructions`: Status of Playwright layer

### Troubleshooting

1. **Lambda timeout**: Increase timeout in stack props (max 15 minutes)

2. **Out of memory**: Increase memorySize in stack props (up to 10 GB)

3. **Playwright not found**: Ensure Playwright layer is attached and `PLAYWRIGHT_BROWSERS_PATH` is set correctly

4. **Resume not found**: Ensure resume PDF is uploaded to S3 bucket or included in Lambda package

5. **Permission errors**: Check IAM roles and policies attached to Lambda function
