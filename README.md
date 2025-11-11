# Greenhouse Auto-Apply Bot Monorepo

A monorepo containing CLI and Lambda packages for automatically applying to Greenhouse jobs.

## Structure

```
.
├── packages/
│   └── lambda/        # AWS Lambda function (headless, EventBridge cron)
├── src/               # Main bot logic (used by CLI and Lambda)
│   ├── index.ts       # GreenhouseAutoApplyBot class
│   ├── test.ts        # Test script for single job URL
│   └── restart.ts     # Restart script for failed jobs
├── config.json        # Configuration file
├── src/cv.html        # Resume HTML file
└── package.json       # Root package.json with workspaces
```

## Packages

### src/ (Main Bot Logic)
Contains the `GreenhouseAutoApplyBot` class used by both CLI and Lambda. The bot logic is in `src/index.ts`.

**CLI Usage:**
```bash
npm run start          # Run the bot
npm run test:job <url> # Test applying to a specific job URL
npm run restart        # Retry failed applications
```

### @greenhouse-bot/lambda
AWS Lambda function that runs the bot in headless mode. Designed to be triggered by EventBridge cron. Uses `JOBS_SEARCH_URL_ONE_DAY` from environment variables. Imports bot logic directly from `src/`.

**Environment Variables:**
- `JOBS_SEARCH_URL_ONE_DAY`: URL for jobs posted in the past day
- `OPENAI_API_KEY`: OpenAI API key for text field auto-fill
- `RESUME_PATH`: Path to resume HTML file (default: `/opt/resume/cv.html`)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Install Playwright browsers:
```bash
npm run playwright:install
```

3. Configure environment variables in `.env`:
```env
OPENAI_API_KEY=your_key_here
JOBS_SEARCH_URL=https://my.greenhouse.io/jobs?query=engineer&date_posted=past_five_days&work_type[]=remote
JOBS_SEARCH_URL_ONE_DAY=https://my.greenhouse.io/jobs?query=engineer&date_posted=past_day&work_type[]=remote
```

4. Build all packages:
```bash
npm run build
```

## Usage

### CLI
```bash
npm run start
```

### Lambda Deployment

#### Option 1: GitHub Actions (Recommended)

1. Configure GitHub Secrets (see `.github/DEPLOYMENT.md`)
2. Push to `main` branch or manually trigger workflow
3. Deployment happens automatically via GitHub Actions

#### Option 2: Manual CDK Deployment

1. Build the lambda package:
```bash
npm run build:lambda
cd packages/lambda
npm install
npm run cdk:bootstrap  # First time only
npm run cdk:deploy
```

2. Set environment variables:
```bash
export OPENAI_API_KEY=your_key
export AWS_ACCOUNT_ID=your_account_id
export AWS_REGION=us-east-1
npm run cdk:deploy
```

#### Option 3: Manual Lambda Package

1. Build the lambda package:
```bash
npm run build:lambda
cd packages/lambda
npm run package
```

2. Upload `function.zip` to AWS Lambda
3. Configure EventBridge rule to trigger the Lambda on a schedule
4. Set environment variables in Lambda configuration

## Features

- Automatic job search and application
- Session persistence (saves login state)
- OpenAI integration for intelligent form filling
- Work authorization handling (British citizen, requires US sponsorship)
- Failed submission tracking
- Headless and non-headless modes
