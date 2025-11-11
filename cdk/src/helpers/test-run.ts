// Test job application with a URL from command line or retry all failed jobs
import { GreenhouseAutoApplyBot } from './index';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

interface FailedJob {
  jobTitle: string;
  url: string;
  timestamp: string;
  reason: string;
}

type FailedJobType = 'submission' | 'application';

interface FailedJobsFile {
  totalFailed: number;
  submissions?: FailedJob[];
  applications?: FailedJob[];
  lastUpdated: string;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function readFailedJobs(fileName: string, type: FailedJobType): Promise<Array<FailedJob & { type: FailedJobType }>> {
  const fullPath = path.join(__dirname, '../../../../', fileName);

  try {
    const content = await fs.readFile(fullPath, 'utf-8');
    const data: FailedJobsFile = JSON.parse(content);
    const jobs = (type === 'submission' ? data.submissions : data.applications) ?? [];

    if (jobs.length === 0) {
      console.log(`ℹ️  No failed ${type}s found`);
      return [];
    }

    console.log(`📋 Found ${jobs.length} failed ${type}(s)`);
    return jobs.map(job => ({ ...job, type }));
  } catch {
    console.log(`ℹ️  No failed ${type} file found or file is empty`);
    return [];
  }
}

async function ensureAuthenticated(bot: GreenhouseAutoApplyBot): Promise<boolean> {
  await bot.initializeBrowser();
  const isAuthenticated = await bot.verifySession();

  if (!isAuthenticated) {
    console.error(
      '❌ Browser context is invalid or expired.\n' +
      '   Please manually login once to create a new .browser-context file.'
    );
    return false;
  }

  console.log('✅ Using saved browser context\n');
  return true;
}

async function retryFailedJobs(bot: GreenhouseAutoApplyBot): Promise<number> {
  const failedJobs = [
    ...(await readFailedJobs('failed-submissions.json', 'submission')),
    ...(await readFailedJobs('failed-applications.json', 'application')),
  ];

  if (failedJobs.length === 0) {
    console.log('✅ No failed jobs to retry!');
    return 0;
  }

  console.log(`🔄 Retrying ${failedJobs.length} failed job(s)...\n`);

  let successCount = 0;

  for (const job of failedJobs) {
    console.log(`\n📝 Retrying ${job.type}: ${job.jobTitle}`);
    console.log(`   🔗 URL: ${job.url}`);
    console.log(`   ⚠️  Previous reason: ${job.reason}\n`);

    try {
      const success = await bot.applyToJobByUrl(job.url, job.jobTitle);

      if (success) {
        successCount++;
        console.log(`   ✅ Successfully applied to: ${job.jobTitle}`);
      } else {
        console.log(`   ❌ Failed to apply to: ${job.jobTitle}`);
      }
    } catch (error) {
      console.error(`   ❌ Error retrying job: ${error}`);
    }

    await wait(5000);
  }

  const failCount = failedJobs.length - successCount;

  console.log(`\n📊 Retry Summary:`);
  console.log(`   ✅ Successful: ${successCount}`);
  console.log(`   ❌ Failed: ${failCount}`);
  console.log(`   📝 Total: ${failedJobs.length}`);

  return failCount;
}

async function applySingleJob(bot: GreenhouseAutoApplyBot, jobUrl: string): Promise<boolean> {
  try {
    new URL(jobUrl);
  } catch {
    console.error('❌ Error: Invalid URL format');
    console.log(`   Provided: ${jobUrl}`);
    console.log('   Expected format: https://my.greenhouse.io/jobs/...');
    return false;
  }

  console.log('🧪 Testing job application with single URL...');
  console.log(`   URL: ${jobUrl}\n`);
  console.log('📝 Applying directly to job URL (skipping job search)...');

  const success = await bot.applyToJobByUrl(jobUrl, 'Software Engineer');
  console.log(`\n${success ? '✅' : '❌'} Application ${success ? 'succeeded' : 'failed'}`);

  return success;
}

(async () => {
  const jobUrl = process.argv[2];
  const bot = new GreenhouseAutoApplyBot();

  try {
    if (!(await ensureAuthenticated(bot))) {
      process.exit(1);
    }

    const result = jobUrl
      ? await applySingleJob(bot, jobUrl)
      : (await retryFailedJobs(bot)) === 0;

    console.log('\n⏳ Keeping browser open for 5 seconds...');
    await wait(5000);

    await bot.close();
    process.exit(result ? 0 : 1);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await bot.close().catch(() => {});
    process.exit(1);
  }
})();
