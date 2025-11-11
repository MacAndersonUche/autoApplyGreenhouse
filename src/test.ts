// Test job application with a URL from command line
import { GreenhouseAutoApplyBot } from './index.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

(async () => {
  // Get job URL from command line arguments
  const jobUrl = process.argv[2];

  if (!jobUrl) {
    console.error('❌ Error: Job URL is required');
    console.log('\nUsage: npm run test:job <job-url>');
    console.log('Example: npm run test:job "https://my.greenhouse.io/jobs/12345"');
    console.log('\nNote: Only one URL can be tested at a time.');
    process.exit(1);
  }

  // Validate URL format
  try {
    new URL(jobUrl);
  } catch (error) {
    console.error('❌ Error: Invalid URL format');
    console.log(`   Provided: ${jobUrl}`);
    console.log('   Expected format: https://my.greenhouse.io/jobs/...');
    process.exit(1);
  }

  console.log('🧪 Testing job application with single URL...');
  console.log(`   URL: ${jobUrl}\n`);

  const bot = new GreenhouseAutoApplyBot();
  
  try {
    await bot.initializeBrowser();
    const needsLogin = !(await bot.verifySession());
    if (needsLogin) {
      console.log('🔐 Session not found, starting login flow...\n');
      await bot.login();
    } else {
      console.log('✅ Using saved session\n');
    }
    
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
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await bot.close().catch(() => {});
    process.exit(1);
  }
})();
