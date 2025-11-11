# Greenhouse Auto-Apply Bot Monorepo

Monorepo for Greenhouse auto-apply bot with CDK backend (API Gateway + Lambda) and Vite frontend.

## Structure

```
.
├── cdk/                    # Backend package (CDK infrastructure)
│   ├── src/
│   │   ├── bot/           # Bot source code (index.ts, test.ts, cv.html)
│   │   └── api/           # Lambda handlers (run-bot.ts, failed-jobs.ts)
│   ├── lib/               # CDK stacks
│   └── bin/               # CDK app entry point
├── frontend/              # Frontend package (Vite)
│   └── src/               # Frontend source
└── package.json           # Root workspace config
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Install Playwright browsers:**
   ```bash
   npm run playwright:install
   ```

3. **Build:**
   ```bash
   npm run build
   ```

## Local Development

### Backend (CDK)

```bash
# Run bot locally (from root)
npm run start
# or
npm run run

# Or from cdk directory
cd cdk
npm run start
# or
npm run run
# or
npm run dev

# Test with specific URL
npm run test <job-url>

# Test retry failed jobs
npm run test
```

### Frontend

```bash
# Start Vite dev server
npm run dev:frontend
```

## Deploy to AWS

```bash
cd cdk
npm run build
npm run cdk:deploy
```

The stack creates:
- API Gateway with REST API
- Lambda functions for `/api/run-bot` and `/api/failed-jobs`
- S3 bucket for storing failed jobs
- CloudWatch logs

After deployment, update frontend `.env`:
```
VITE_API_URL=https://your-api-id.execute-api.region.amazonaws.com/prod
```

## Browser Context Setup

The bot uses a saved browser context (`.browser-context` file) for authentication. 

**First-time setup:**
1. Run the bot: `npm run start`
2. A browser window will open
3. Manually login to Greenhouse in the browser
4. The session will be automatically saved to `.browser-context`
5. Future runs will use this saved session automatically

**Note:** The `.browser-context` file contains your session cookies and should be kept secure.

## Environment Variables

Set in `.env` file or AWS Lambda environment:

**Optional:**
- `OPENAI_API_KEY` - For AI form filling
- `RESUME_PATH` - Path to resume file (default: `./cv.html`)
- `MAX_APPLICATIONS` - Max apps per run (default: 10)
- `DELAY_MS` - Delay between apps (default: 20000)
- `JOBS_SEARCH_URL` - Search URL for jobs

## Workspaces

- `cdk` - Backend with CDK infrastructure
- `frontend` - Vite frontend application
