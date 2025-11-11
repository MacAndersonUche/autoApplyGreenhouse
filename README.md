# Greenhouse Auto-Apply Bot Monorepo

A monorepo containing CLI and Lambda packages for automatically applying to Greenhouse jobs.

## Structure

```
.
├── packages/
│   ├── core/          # Shared bot logic
│   ├── cli/           # CLI application (non-headless)
│   └── lambda/        # AWS Lambda function (headless, EventBridge cron)
├── config.json        # Configuration file
├── MacAndersonUcheCVAB.pdf  # Resume file
└── package.json       # Root package.json with workspaces
```

## Packages

### @greenhouse-bot/core
Shared bot logic used by both CLI and Lambda packages. Contains the `GreenhouseAutoApplyBot` class.

### @greenhouse-bot/cli
CLI application that runs the bot in non-headless mode. Uses `JOBS_SEARCH_URL` from environment variables.

**Usage:**
```bash
npm run start          # Run the bot
npm run test:job <url> # Test applying to a specific job URL
```

### @greenhouse-bot/lambda
AWS Lambda function that runs the bot in headless mode. Designed to be triggered by EventBridge cron. Uses `JOBS_SEARCH_URL_ONE_DAY` from environment variables.

**Environment Variables:**
- `JOBS_SEARCH_URL_ONE_DAY`: URL for jobs posted in the past day
- `OPENAI_API_KEY`: OpenAI API key for text field auto-fill
- `RESUME_PATH`: Path to resume PDF (default: `/opt/resume/MacAndersonUcheCVAB.pdf`)

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
JOBS_SEARCH_URL=https://my.greenhouse.io/jobs?query=software%20engineer&date_posted=past_five_days&work_type[]=remote
JOBS_SEARCH_URL_ONE_DAY=https://my.greenhouse.io/jobs?query=software%20engineer%20&date_posted=past_day&work_type[]=remote
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
