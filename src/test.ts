// Test job application with a URL from command line
import { GreenhouseAutoApplyBot } from './index.js';

(async () => {
  // Get job URL from command line arguments
  const jobUrl = process.argv[2];

  if (!jobUrl) {
    console.error('❌ Error: Job URL is required');
    console.log('Usage: npm run test:job <job-url>');
    console.log('Example: npm run test:job "https://my.greenhouse.io/jobs/12345"');
    process.exit(1);
  }

  console.log(`🧪 Testing job application...`);
  console.log(`   URL: ${jobUrl}\n`);

  const bot = new GreenhouseAutoApplyBot();
  
  try {
    await bot.initializeBrowser();
    const needsLogin = !(await bot.verifySession());
    if (needsLogin) {
      await bot.login();
    }
    
    const success = await bot.applyToJobByUrl(jobUrl);
    console.log(`\n${success ? '✅' : '❌'} Application ${success ? 'succeeded' : 'failed'}`);
    
    await bot.close();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    await bot.close();
    process.exit(1);
  }
})();
