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

interface FailedSubmissions {
  totalFailed: number;
  submissions: FailedJob[];
  lastUpdated: string;
}

interface FailedApplications {
  totalFailed: number;
  applications: FailedJob[];
  lastUpdated: string;
}

(async () => {
  // Get job URL from command line arguments
  const jobUrl = process.argv[2];

  const bot = new GreenhouseAutoApplyBot();
  
  try {
    await bot.initializeBrowser();
    const isAuthenticated = await bot.verifySession();
    if (!isAuthenticated) {
      console.error(
        '❌ Browser context is invalid or expired.\n' +
        '   Please manually login once to create a new .browser-context file.'
      );
      await bot.close();
      process.exit(1);
    } else {
      console.log('✅ Using saved browser context\n');
    }

    // If URL is provided, test single job
    if (jobUrl) {
      // Validate URL format
      try {
        new URL(jobUrl);
      } catch (error) {
        console.error('❌ Error: Invalid URL format');
        console.log(`   Provided: ${jobUrl}`);
        console.log('   Expected format: https://my.greenhouse.io/jobs/...');
        await bot.close();
        process.exit(1);
      }

      console.log('🧪 Testing job application with single URL...');
      console.log(`   URL: ${jobUrl}\n`);
      
      // When URL is provided, ONLY navigate to that URL and apply - no job search
      console.log(`📝 Applying directly to job URL (skipping job search)...`);
      console.log(`   URL: ${jobUrl}\n`);
      const success = await bot.applyToJobByUrl(jobUrl, 'Software Engineer');
      
      console.log(`\n${success ? '✅' : '❌'} Application ${success ? 'succeeded' : 'failed'}`);
      
      // Keep browser open for a few seconds to see results
      console.log('\n⏳ Keeping browser open for 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      await bot.close();
      process.exit(success ? 0 : 1);
    } else {
      // No URL provided, retry all failed jobs
      console.log('🔄 Restarting failed job applications...\n');

      // Read failed submissions
      const failedSubmissionsPath = path.join(__dirname, '../../../../failed-submissions.json');
      const failedApplicationsPath = path.join(__dirname, '../../../../failed-applications.json');

      let failedSubmissions: FailedSubmissions = { totalFailed: 0, submissions: [], lastUpdated: '' };
      let failedApplications: FailedApplications = { totalFailed: 0, applications: [], lastUpdated: '' };

      try {
        const submissionsContent = await fs.readFile(failedSubmissionsPath, 'utf-8');
        failedSubmissions = JSON.parse(submissionsContent);
        console.log(`📋 Found ${failedSubmissions.submissions.length} failed submissions`);
      } catch (error) {
        console.log('ℹ️  No failed submissions file found or empty');
      }

      try {
        const applicationsContent = await fs.readFile(failedApplicationsPath, 'utf-8');
        failedApplications = JSON.parse(applicationsContent);
        console.log(`📋 Found ${failedApplications.applications.length} failed applications\n`);
      } catch (error) {
        console.log('ℹ️  No failed applications file found or empty\n');
      }

      const allFailedJobs: Array<FailedJob & { type: 'submission' | 'application' }> = [
        ...failedSubmissions.submissions.map(job => ({ ...job, type: 'submission' as const })),
        ...failedApplications.applications.map(job => ({ ...job, type: 'application' as const })),
      ];

      if (allFailedJobs.length === 0) {
        console.log('✅ No failed jobs to retry!');
        await bot.close();
        process.exit(0);
      }

      console.log(`🔄 Retrying ${allFailedJobs.length} failed job(s)...\n`);

      let successCount = 0;
      let failCount = 0;

      for (const job of allFailedJobs) {
        console.log(`\n📝 Retrying ${job.type}: ${job.jobTitle}`);
        console.log(`   🔗 URL: ${job.url}`);
        console.log(`   ⚠️  Previous reason: ${job.reason}\n`);

        try {
          const success = await bot.applyToJobByUrl(job.url, job.jobTitle);
          
          if (success) {
            successCount++;
            console.log(`   ✅ Successfully applied to: ${job.jobTitle}`);
          } else {
            failCount++;
            console.log(`   ❌ Failed to apply to: ${job.jobTitle}`);
          }

          // Wait between applications
          await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
          failCount++;
          console.error(`   ❌ Error retrying job: ${error}`);
        }
      }

      console.log(`\n📊 Retry Summary:`);
      console.log(`   ✅ Successful: ${successCount}`);
      console.log(`   ❌ Failed: ${failCount}`);
      console.log(`   📝 Total: ${allFailedJobs.length}`);

      // Keep browser open for a few seconds
      console.log('\n⏳ Keeping browser open for 5 seconds...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      await bot.close();
      process.exit(failCount > 0 ? 1 : 0);
    }
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await bot.close().catch(() => {});
    process.exit(1);
  }
})();
