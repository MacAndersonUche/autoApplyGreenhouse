import { chromium, Browser, Page } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();


interface Job {
  href: string;
  title: string;
  viewButton?: any; // Playwright ElementHandle for the view button
}

export class GreenhouseAutoApplyBot {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private context: any = null; // Browser context for tab management
  private baseURL = 'https://my.greenhouse.io';
  private resumePath: string;
  private coverLetterPath: string;
  private contextPath: string;
  private openai: OpenAI | null = null;
  private failedSubmissions: Array<{ jobTitle: string; url: string; timestamp: string; reason: string }> = [];
  private failedApplications: Array<{ jobTitle: string; url: string; timestamp: string; reason: string }> = [];

  constructor() {
    this.resumePath = process.env.RESUME_PATH || path.join(__dirname, 'cv.html');
    this.coverLetterPath = process.env.COVER_LETTER_PATH || './cover-letter.txt';
    // Use existing .browser-context file in project root (hardcoded)
    // This file contains the saved browser session with cookies and authentication
    this.contextPath = path.resolve(process.cwd(), '.browser-context');
    
    // Initialize OpenAI if API key is provided
    // API key must be set in .env file as OPENAI_API_KEY
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      this.openai = new OpenAI({
        apiKey: openaiApiKey,
      });
      console.log('✅ OpenAI initialized for text box auto-fill');
    } else {
      console.warn('⚠️  OPENAI_API_KEY not found in .env file. Text box auto-fill will be disabled.');
    }
  }


  async initializeBrowser(): Promise<void> {
    console.log('🌐 Launching browser...');
    
    // Check if we have a saved browser context
    const hasSavedContext = fsSync.existsSync(this.contextPath);
    
    if (hasSavedContext) {
      console.log('📦 Found saved browser context, attempting to restore...');
      try {
        // Launch browser in headless mode
        this.browser = await chromium.launch({
          headless: true,
        });
        
        // Load saved browser context (includes cookies, localStorage, etc.)
        this.context = await this.browser.newContext({
          storageState: this.contextPath,
        });
        
        if (this.context) {
          this.page = await this.context.newPage();
          if (this.page) {
            await this.page.setViewportSize({ width: 1280, height: 720 });
            
            // Verify session is still valid
            const isValid = await this.verifySession();
            if (isValid) {
              console.log('✅ Browser context restored successfully!');
              return;
            } else {
              console.log('⚠️  Saved browser context expired or invalid');
              await this.page.close();
              if (this.context) {
                await this.context.close();
              }
              this.context = null;
              this.page = null;
              if (this.browser) {
                await this.browser.close();
                this.browser = null;
              }
              // Will throw error below - user needs to manually login again
            }
          }
        }
      } catch (error) {
        console.error('❌ Could not restore browser context:', error);
        if (this.browser) {
          await this.browser.close();
          this.browser = null;
        }
        throw new Error(
          'Failed to load browser context. Please ensure .browser-context file exists and is valid.\n' +
          'To create a new session, run the bot and manually login once - the session will be saved automatically.'
        );
      }
    } else {
      // No saved context found - throw error since we require existing .browser-context
      throw new Error(
        '❌ Browser context file (.browser-context) not found at: ' + this.contextPath + '\n' +
        '   Please ensure the .browser-context file exists in the project root directory.'
      );
    }
  }

  async verifySession(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      // Navigate to jobs page to check if we're logged in
      await this.page.goto(`${this.baseURL}/jobs`, {
        waitUntil: 'networkidle',
        timeout: 10000,
      });

      // Note: Cookie modal will be handled after clicking "View Job" button

      // Check if we're redirected to sign in page (means not logged in)
      const currentURL = this.page.url();
      if (currentURL.includes('/users/sign_in')) {
        return false;
      }

      // Check if we can see jobs page content
      await this.page.waitForSelector('body', { timeout: 5000 });
      return true;
    } catch (error) {
      return false;
    }
  }

  async saveSession(): Promise<void> {
    if (!this.page) {
      return;
    }

    try {
      const context = this.page.context();
      await context.storageState({ path: this.contextPath });
      console.log('💾 Session saved successfully!');
    } catch (error) {
      console.warn('⚠️  Could not save session:', error);
    }
  }

  async login(): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    console.log('🔐 Navigating to sign in page...');
    await this.page.goto(`${this.baseURL}/users/sign_in`, {
      waitUntil: 'networkidle',
    });

    // Note: Cookie modal will be handled after clicking "View Job" button

    // Pre-fill email if available
    const email = process.env.EMAIL || 'hi@macandersonuche.dev';
    try {
      const emailInput = await this.page.$('input[type="email"], input[name*="email"], input[id*="email"]');
      if (emailInput) {
        await emailInput.fill(email);
        console.log(`📧 Pre-filled email: ${email}`);
      }
    } catch (error) {
      // Email field not found or couldn't fill, continue with manual entry
    }

    console.log('\n📝 Please complete the sign-in process in the browser:');
    console.log(`   1. Email should be pre-filled: ${email}`);
    console.log('   2. Enter your password');
    console.log('   3. Enter the verification code if prompted');
    console.log('   4. Wait for the page to redirect to /jobs');
    console.log('\n⏳ Waiting for authentication...\n');

      // Wait for navigation to /jobs page (indicates successful login)
      try {
        await this.page.waitForURL(
          (url) => url.pathname === '/jobs' || url.pathname.startsWith('/jobs'),
          { timeout: 300000 } // 5 minutes timeout
        );

        // Note: Cookie modal will be handled after clicking "View Job" button

        // Verify we're actually logged in by checking for jobs page content
        await this.page.waitForSelector('body', { timeout: 10000 });
        
        const currentURL = this.page.url();
        if (currentURL.includes('/jobs')) {
          console.log('✅ Successfully authenticated!');
          // Save session for future use
          await this.saveSession();
          return true;
        }
    } catch (error) {
      console.error('❌ Authentication timeout or failed');
      console.error('Please ensure you completed the login process');
      return false;
    }

    return false;
  }

  async searchJobs(shouldNavigate: boolean = true): Promise<Job[]> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    // Navigate directly to jobs page with search parameters only if needed
    if (shouldNavigate) {
      console.log('🔍 Navigating to jobs page with search filters...');
      // Navigate directly to URL with query parameters from environment variable
      const searchUrl = process.env.JOBS_SEARCH_URL || `${this.baseURL}/jobs?query=engineer&date_posted=past_five_days&work_type[]=remote`;
      console.log(`   📍 Using search URL: ${searchUrl}`);
      await this.page.goto(searchUrl, {
        waitUntil: 'networkidle',
      });
      // Wait for page to load
      await this.page.waitForTimeout(1000);

      // Note: Cookie modal will be handled after clicking "View Job" button
      
      // Wait a bit more
      await this.page.waitForTimeout(1000);

      // Load ALL jobs before extracting them
      await this.loadAllJobs();
    } else {
      // Already on jobs page, just wait a bit for any new content
      await this.page.waitForTimeout(1000);
    }

    // Wait for job listings to appear
    console.log('⏳ Waiting for job listings to appear...');
    try {
      await this.page.waitForSelector('a[href*="/jobs/"], button:has-text("View job"), a:has-text("View job"), button:has-text("View Job"), a:has-text("View Job")', { timeout: 15000 });
    } catch (error) {
      console.warn('⚠️  Could not find job listings, trying alternative selectors...');
      // Try waiting a bit more and check page content
      await this.page.waitForTimeout(3000);
    }

    // Find all job cards/listings with their titles and "view job" buttons
    let jobElements: Array<{ title: string; viewButton: any }> = [];
    try {
      // Wait a bit more for the grid to render
      await this.page.waitForTimeout(2000);
      
      // Get all job cards - try multiple approaches
      let cards: any[] = [];
      
      // Method 1: Look for cards containing "View job" buttons
      const viewJobButtons = await this.page.$$('button:has-text("View job"), a:has-text("View job"), button:has-text("View Job"), a:has-text("View Job")');
      console.log(`📊 Found ${viewJobButtons.length} "View job" buttons`);
      
      if (viewJobButtons.length > 0) {
        // For each button, find its parent card and extract the title
        for (const button of viewJobButtons) {
          try {
            // Find the parent card/container
            const cardHandle = await button.evaluateHandle((btn) => {
              let parent = btn.closest('[class*="card"], [class*="job"], article, [class*="listing"], [class*="item"]') as HTMLElement | null;
              if (!parent) {
                // Try going up a few levels
                parent = btn.parentElement?.parentElement?.parentElement as HTMLElement | null;
              }
              return parent;
            });
            
            const cardElement = cardHandle?.asElement();
            if (cardElement) {
              // Get all text from the card to find the title
              const cardText = await cardElement.textContent();
              
              // Extract job title - usually the first large text or text containing "Engineer"
              if (cardText && /engineer/i.test(cardText)) {
                // Try to get a more specific title by looking for headings or large text
                const titleElement = await cardElement.$('h1, h2, h3, h4, [class*="title"], [class*="name"]').catch(() => null);
                let title = '';
                if (titleElement) {
                  title = (await titleElement.textContent())?.trim() || '';
                }
                
                // Fallback: extract from card text (first line or text before company name)
                if (!title) {
                  const lines = cardText.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
                  title = lines.find((line: string) => /engineer/i.test(line)) || lines[0] || cardText.split('\n')[0].trim();
                }
                
                if (title && /engineer/i.test(title)) {
                  jobElements.push({ 
                    title: title, 
                    viewButton: button 
                  });
                }
              }
            }
          } catch (e) {
            // Try direct approach - get text near the button
            try {
              const buttonText = await button.textContent();
              if (buttonText && /view job/i.test(buttonText)) {
                // Get the parent and look for title
                const parentHandle = await button.evaluateHandle((btn) => btn.parentElement?.parentElement);
                const parentElement = parentHandle?.asElement();
                if (parentElement) {
                  const parentText = await parentElement.textContent();
                  if (parentText && /engineer/i.test(parentText)) {
                    const lines = parentText.split('\n').filter((l: string) => l.trim());
                    const title = lines.find((l: string) => /engineer/i.test(l)) || lines[0];
                    if (title) {
                      jobElements.push({ title: title.trim(), viewButton: button });
                    }
                  }
                }
              }
            } catch (e2) {
              continue;
            }
          }
        }
      }
      
      // Method 2: Find all cards and check for matching titles
      if (jobElements.length === 0) {
        const cardSelectors = [
          'article',
          '[class*="card"]',
          '[class*="job"]',
          '[class*="listing"]',
          '[class*="item"]',
          'div[class*="grid"] > div',
        ];
        
        for (const selector of cardSelectors) {
          try {
            const foundCards = await this.page.$$(selector);
            if (foundCards.length > 0) {
              console.log(`📊 Found ${foundCards.length} elements with selector: ${selector}`);
              
              for (const card of foundCards) {
                try {
                  const cardText = await card.textContent();
                  if (cardText && /engineer/i.test(cardText)) {
                    // Find view job button in this card
                    const viewButton = await card.$('button:has-text("View job"), a:has-text("View job"), button:has-text("View Job"), a:has-text("View Job")');
                    if (viewButton) {
                      // Extract title
                      const titleElement = await card.$('h1, h2, h3, h4, [class*="title"]');
                      const title = titleElement 
                        ? (await titleElement.textContent())?.trim() || ''
                        : cardText.split('\n').find(line => /engineer/i.test(line)) || cardText.split('\n')[0].trim();
                      
                      if (title) {
                        jobElements.push({ title, viewButton });
                      }
                    }
                  }
                } catch (e) {
                  continue;
                }
              }
              
              if (jobElements.length > 0) break;
            }
          } catch (e) {
            continue;
          }
        }
      }

      console.log(`✅ Found ${jobElements.length} jobs matching "engineer"`);
    } catch (error) {
      console.error('❌ Error finding job listings:', error);
      console.log('   Current page URL:', this.page.url());
      return [];
    }

    if (jobElements.length === 0) {
      console.warn('⚠️  No matching jobs found. The page structure may have changed.');
      console.log('   Current page URL:', this.page.url());
      return [];
    }

    // Return job elements with their view buttons
    return jobElements.map((job, index) => ({
      href: `job-${index}`, // Placeholder, will use button click instead
      title: job.title,
      viewButton: job.viewButton,
    }));
  }

  async fillSearchForm(): Promise<void> {
    if (!this.page) {
      return;
    }

    try {
      // Fill job title: "software engineer"
      const titleSelectors = [
        'input[name*="title"]',
        'input[name*="job"]',
        'input[placeholder*="title" i]',
        'input[placeholder*="job" i]',
        'input[type="text"]',
        'input[class*="search"]',
        'input[class*="title"]',
      ];

      let titleFilled = false;
      for (const selector of titleSelectors) {
        try {
          const titleInput = await this.page.$(selector);
          if (titleInput) {
            await titleInput.fill('engineer');
            console.log('   ✅ Filled job title: engineer');
            titleFilled = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      await this.page.waitForTimeout(500);

      // Fill location: "United States" - try both text inputs and select dropdowns
      console.log('   🌍 Filling location field: United States...');
      let locationFilled = false;
      
      // First try text input fields
      const locationInputSelectors = [
        'input[name*="location"]',
        'input[placeholder*="location" i]',
        'input[class*="location"]',
        'input[type="text"][name*="location"]',
        'input[id*="location"]',
      ];

      for (const selector of locationInputSelectors) {
        try {
          const locationInput = await this.page.$(selector);
          if (locationInput) {
            await locationInput.fill('United States');
            await this.page.waitForTimeout(500);
            // Trigger input event to ensure the value is recognized
            await locationInput.evaluate((el) => {
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            });
            console.log('   ✅ Filled location input: United States');
            locationFilled = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // If not filled, try select dropdowns
      if (!locationFilled) {
        const locationSelectSelectors = [
          'select[name*="location"]',
          'select[class*="location"]',
          'select[id*="location"]',
        ];

        for (const selector of locationSelectSelectors) {
          try {
            const locationSelect = await this.page.$(selector);
            if (locationSelect) {
              const options = await locationSelect.$$eval('option', (opts) =>
                opts.map((opt) => ({ value: opt.value, text: opt.textContent?.trim() || '' }))
              );
              
              // Try to find "United States" option
              const usOption = options.find((opt) => 
                /united states|usa|us/i.test(opt.text) || 
                /united states|usa|us/i.test(opt.value)
              );
              
              if (usOption) {
                await locationSelect.selectOption(usOption.value);
                console.log(`   ✅ Selected location: ${usOption.text || 'United States'}`);
                locationFilled = true;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      }

      if (!locationFilled) {
        console.warn('   ⚠️  Could not find location field to fill');
      }

      await this.page.waitForTimeout(500);

      // Select work type: "remote"
      const workTypeSelectors = [
        'select[name*="work"]',
        'select[name*="type"]',
        'select[name*="location"]',
        'select[class*="work"]',
        'select[class*="type"]',
        'select[class*="location"]',
      ];

      let workTypeSelected = false;
      for (const selector of workTypeSelectors) {
        try {
          const workTypeSelect = await this.page.$(selector);
          if (workTypeSelect) {
            const options = await workTypeSelect.$$eval('option', (opts) =>
              opts.map((opt) => ({ value: opt.value, text: opt.textContent?.trim() || '' }))
            );
            const remoteOption = options.find((opt) => 
              /remote/i.test(opt.text) || /remote/i.test(opt.value)
            );
            if (remoteOption) {
              await workTypeSelect.selectOption(remoteOption.value);
              console.log(`   ✅ Selected work type: ${remoteOption.text || 'remote'}`);
              workTypeSelected = true;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      await this.page.waitForTimeout(500);

      // Select date posted: "past 10 days"
      const dateSelectors = [
        'select[name*="date"]',
        'select[name*="posted"]',
        'select[name*="time"]',
        'select[class*="date"]',
        'select[class*="posted"]',
      ];

      let dateSelected = false;
      for (const selector of dateSelectors) {
        try {
          const dateSelect = await this.page.$(selector);
          if (dateSelect) {
            const options = await dateSelect.$$eval('option', (opts) =>
              opts.map((opt) => ({ value: opt.value, text: opt.textContent?.trim() || '' }))
            );
            const tenDaysOption = options.find((opt) => 
              /10 days|past 10|last 10|10/i.test(opt.text) || /10/i.test(opt.value)
            );
            if (tenDaysOption) {
              await dateSelect.selectOption(tenDaysOption.value);
              console.log(`   ✅ Selected date: ${tenDaysOption.text}`);
              dateSelected = true;
              break;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Click search button if form was filled
      if (titleFilled || locationFilled || workTypeSelected || dateSelected) {
        await this.page.waitForTimeout(500);
        const searchButtonSelectors = [
          'button[type="submit"]',
          'button:has-text("Search")',
          'button:has-text("Find")',
          'input[type="submit"]',
          'button[class*="search"]',
        ];

        for (const selector of searchButtonSelectors) {
          try {
            const searchButton = await this.page.$(selector);
            if (searchButton) {
              await searchButton.click();
              console.log('   ✅ Clicked search button');
              await this.page.waitForTimeout(2000);
              break;
            }
          } catch (e) {
            continue;
          }
        }
      }
    } catch (error) {
      console.warn('⚠️  Error filling search form:', error);
    }
  }

  async loadMoreJobs(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      // Look for "See more jobs" or similar link/button
      const moreJobsSelectors = [
        'a:has-text("See more jobs")',
        'a:has-text("See More Jobs")',
        'a:has-text("Load more")',
        'a:has-text("Load More")',
        'button:has-text("See more")',
        'button:has-text("Load more")',
        '[class*="see-more"]',
        '[class*="load-more"]',
        'a[href*="more"]',
      ];

      for (const selector of moreJobsSelectors) {
        try {
          const moreButton = await this.page.$(selector);
          if (moreButton) {
            const isVisible = await moreButton.isVisible().catch(() => false);
            if (isVisible) {
              console.log('   📄 Clicking "See more jobs" to load additional jobs...');
              await moreButton.click();
              await this.page.waitForTimeout(2000);
              await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
              return true;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Try scrolling to bottom to trigger lazy loading
      console.log('   📜 Scrolling to bottom to trigger lazy loading...');
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await this.page.waitForTimeout(2000);
      
      // Check if new jobs appeared
      const newJobs = await this.page.$$('a[href*="/jobs/"], button:has-text("View job"), a:has-text("View job")');
      return newJobs.length > 0;
    } catch (error) {
      console.warn('   ⚠️  Could not load more jobs:', error);
      return false;
    }
  }

  async loadAllJobs(): Promise<void> {
    if (!this.page) {
      return;
    }

    console.log('📋 Loading all available jobs...');
    let previousJobCount = 0;
    let attempts = 0;
    const maxAttempts = 50; // Prevent infinite loops

    while (attempts < maxAttempts) {
      // Count current visible jobs
      const currentJobs = await this.page.$$('a[href*="/jobs/"], button:has-text("View job"), a:has-text("View job"), button:has-text("View Job"), a:has-text("View Job")');
      const currentJobCount = currentJobs.length;

      console.log(`   📊 Currently visible jobs: ${currentJobCount}`);

      // If job count hasn't increased, we've loaded all jobs
      if (currentJobCount === previousJobCount && previousJobCount > 0) {
        console.log('   ✅ All jobs loaded!');
        break;
      }

      previousJobCount = currentJobCount;

      // Try to load more jobs
      const hasMore = await this.loadMoreJobs();
      
      if (!hasMore) {
        // Wait a bit and check again
        await this.page.waitForTimeout(2000);
        const finalCheck = await this.page.$$('a[href*="/jobs/"], button:has-text("View job"), a:has-text("View job"), button:has-text("View Job"), a:has-text("View Job")');
        if (finalCheck.length === currentJobCount) {
          console.log('   ✅ All jobs loaded!');
          break;
        }
      }

      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.log('   ⚠️  Reached maximum attempts, proceeding with currently loaded jobs');
    }

    const finalJobs = await this.page.$$('a[href*="/jobs/"], button:has-text("View job"), a:has-text("View job"), button:has-text("View Job"), a:has-text("View Job")');
    console.log(`\n✅ Total jobs loaded: ${finalJobs.length}\n`);
  }

  /**
   * Apply to a job by URL - can be called independently for testing
   * @param jobUrl - The URL of the job application page
   * @param jobTitle - Optional job title for logging and tracking
   * @returns Promise<boolean> - true if application was successful, false otherwise
   */
  async applyToJobByUrl(jobUrl: string, jobTitle: string = 'Software Engineer'): Promise<boolean> {
    if (!this.page || !this.context) {
      throw new Error('Page or context not initialized. Call initializeBrowser() first.');
    }

    try {
      console.log(`\n📝 Processing job application: ${jobTitle}`);
      console.log(`   🔗 URL: ${jobUrl}`);
      
      // Navigate to the job URL
      await this.page.goto(jobUrl, { waitUntil: 'networkidle' });
      await this.page.waitForTimeout(1000);

      // Handle cookie modal immediately after page load
      await this.handleCookieModal();
      
      await this.page.waitForTimeout(1000);

      // Perform the application process
      return await this.performJobApplication(jobTitle);
    } catch (error) {
      console.error(`   ❌ Error applying to job: ${error}`);
      return false;
    }
  }

  /**
   * Check if submission was successful by looking for success indicators on the page
   * @returns Promise<boolean> - true if success indicators are found
   */
  private async checkSubmissionSuccess(): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    try {
      // Get page content to check for success messages
      const pageContent = await this.page.content();
      const pageText = await this.page.textContent('body').catch(() => null) || '';
      
      // Check for LINQ-specific success message
      const linqSuccessIndicators = [
        /thanks a ton for applying/i,
        /join the LINQ team/i,
        /super excited/i,
        /talent acquisition team/i,
        /we're currently reviewing/i,
        /we'll be in touch soon/i,
      ];
      
      const hasLinqSuccess = linqSuccessIndicators.some(pattern => 
        pattern.test(pageContent) || (pageText && pattern.test(pageText))
      );
      
      if (hasLinqSuccess) {
        console.log('   ✅ Found LINQ success message on page');
        return true;
      }
      
      // Check for generic success indicators
      const genericSuccessIndicators = [
        /success/i,
        /submitted/i,
        /thank you/i,
        /application received/i,
        /thanks for applying/i,
      ];
      
      const hasGenericSuccess = genericSuccessIndicators.some(pattern => 
        pattern.test(pageContent) || (pageText && pattern.test(pageText))
      );
      
      return hasGenericSuccess;
    } catch (error) {
      return false;
    }
  }

  /**
   * Wait for submission success confirmation with various indicators
   * @param timeoutMs - Maximum time to wait in milliseconds
   * @returns Promise<boolean> - true if success is confirmed
   */
  private async waitForSubmissionSuccess(timeoutMs: number = 60000): Promise<boolean> {
    if (!this.page) {
      return false;
    }

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      // Check for success using helper method
      if (await this.checkSubmissionSuccess()) {
        return true;
      }
      
      // Also check for success selectors
      try {
        await Promise.race([
          this.page.waitForSelector('text=/success|submitted|thank you|application received|thanks a ton|LINQ team/i', { timeout: 2000 }).then(() => true),
          this.page.waitForSelector('[class*="success"]', { timeout: 2000 }).then(() => true),
          this.page.waitForSelector('[class*="submitted"]', { timeout: 2000 }).then(() => true),
          this.page.waitForURL(/success|submitted|thank/i, { timeout: 2000 }).then(() => true),
        ]);
        return true;
      } catch (e) {
        // Continue checking
      }
      
      await this.page.waitForTimeout(1000);
    }
    
    // Final check
    return await this.checkSubmissionSuccess();
  }

  /**
   * Core job application logic - extracted for reuse
   * @param jobTitle - Job title for logging and tracking
   * @returns Promise<boolean> - true if application was successful, false otherwise
   */
  private async performJobApplication(jobTitle: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Page not initialized');
    }

    const applicationStartTime = Date.now();
    const maxApplicationTime = 30000; // 30 seconds

    try {
      // First, try clicking into a text input to trigger auto-fill
      console.log('   📝 Clicking into text input to trigger auto-fill...');
      let fieldsPopulated = false;
      try {
        const textBoxSelectors = [
          'input[type="text"]',
          'input[type="email"]',
          'textarea',
          'input[name*="name"]',
          'input[name*="email"]',
          'input[class*="input"]',
          '[contenteditable="true"]',
        ];

        for (const selector of textBoxSelectors) {
          try {
            const textBox = await this.page.$(selector);
            if (textBox) {
              await textBox.click();
              await this.page.waitForTimeout(1500); // Wait for auto-fill to populate
              
              // Check if any fields got populated
              const allInputs = await this.page.$$('input[type="text"], input[type="email"], textarea');
              let filledCount = 0;
              for (const input of allInputs.slice(0, 5)) { // Check first 5 inputs
                try {
                  const value = await input.inputValue();
                  if (value && value.trim().length > 0) {
                    filledCount++;
                  }
                } catch (e) {
                  continue;
                }
              }
              
              if (filledCount > 0) {
                console.log(`   ✅ Auto-fill triggered by clicking text input (${filledCount} fields populated)`);
                fieldsPopulated = true;
                break;
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        console.warn('   ⚠️  Error clicking text input:', error);
      }

      // If fields didn't populate, try clicking the "Autofill with MyGreenhouse" button
      if (!fieldsPopulated) {
        console.log('   📝 Fields not populated, looking for "Autofill with MyGreenhouse" button...');
        try {
          // Try multiple selectors to find the autofill button (case sensitive: capital A and M)
          const autofillButtonSelectors = [
            'button:has-text("Autofill with MyGreenhouse")',
            'a:has-text("Autofill with MyGreenhouse")',
            '[role="button"]:has-text("Autofill with MyGreenhouse")',
            'button[class*="autofill" i]',
            'a[class*="autofill" i]',
            'button[id*="autofill" i]',
            'a[id*="autofill" i]',
          ];

          let autofillButtonFound = false;
          for (const selector of autofillButtonSelectors) {
            try {
              const autofillButton = await this.page.$(selector);
              if (autofillButton) {
                // Check if the button text matches exactly (case sensitive: "Autofill with MyGreenhouse")
                const buttonText = await autofillButton.textContent();
                if (buttonText && buttonText.includes('Autofill with MyGreenhouse')) {
                  const isVisible = await autofillButton.isVisible().catch(() => false);
                  if (isVisible) {
                    // Scroll button into view if needed
                    await autofillButton.scrollIntoViewIfNeeded().catch(() => {});
                    await this.page.waitForTimeout(200);
                    
                    // Try clicking with multiple methods
                    try {
                      await autofillButton.click({ timeout: 2000 });
                    } catch (e) {
                      // Fallback: use JavaScript click
                      await autofillButton.evaluate((btn: HTMLElement) => {
                        (btn as HTMLElement).click();
                      });
                    }
                    
                    await this.page.waitForTimeout(1500);
                    console.log('   ✅ Clicked "Autofill with MyGreenhouse" button');
                    autofillButtonFound = true;
                    break;
                  }
                }
              }
            } catch (e) {
              continue;
            }
          }

          // Fallback: Try using evaluate to find button with exact text match (case sensitive)
          if (!autofillButtonFound) {
            try {
              const clicked = await this.page.evaluate(() => {
                const allButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const autofillButton = allButtons.find((btn: Element) => {
                  const text = btn.textContent || '';
                  return text.includes('Autofill with MyGreenhouse');
                });

                if (autofillButton) {
                  const style = window.getComputedStyle(autofillButton as HTMLElement);
                  if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    (autofillButton as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              });

              if (clicked) {
                await this.page.waitForTimeout(1500);
                console.log('   ✅ Clicked "Autofill with MyGreenhouse" button (via evaluate)');
                autofillButtonFound = true;
              }
            } catch (e) {
              // Silently continue if evaluate fails
            }
          }

          if (!autofillButtonFound) {
            console.warn('   ⚠️  Could not find "Autofill with MyGreenhouse" button');
          }
        } catch (error) {
          console.warn('   ⚠️  Error looking for autofill button:', error);
        }
      }

      // Scroll to the end of the page
      console.log('   📜 Scrolling to end of page...');
      await this.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await this.page.waitForTimeout(1000);

      // Check if we've exceeded 30 seconds before continuing
      const elapsedTime = Date.now() - applicationStartTime;
      if (elapsedTime >= maxApplicationTime) {
        const jobUrl = this.page.url();
        console.log(`   ⏱️  Application process exceeded 30 seconds (${Math.round(elapsedTime / 1000)}s), marking as failed`);
        this.failedApplications.push({
          jobTitle: jobTitle,
          url: jobUrl,
          timestamp: new Date().toISOString(),
          reason: `Application process exceeded 30 seconds before finding apply button`
        });
        await this.saveFailedApplications();
        return false;
      }

      // Look for apply button
      const applySelectors = [
        'button:has-text("Apply")',
        'a:has-text("Apply")',
        'button[class*="apply"]',
        'a[class*="apply"]',
        'button[type="submit"]',
        '[data-testid*="apply"]',
      ];

      let applyButton = null;
      for (const selector of applySelectors) {
        try {
          applyButton = await this.page.$(selector);
          if (applyButton) {
            console.log(`   ✅ Found apply button`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!applyButton) {
        console.log('   ⚠️  Apply button not found, skipping...');
        
        // Check if we've exceeded 30 seconds
        const elapsedTimeAfterSearch = Date.now() - applicationStartTime;
        if (elapsedTimeAfterSearch >= maxApplicationTime) {
          const jobUrl = this.page.url();
          this.failedApplications.push({
            jobTitle: jobTitle,
            url: jobUrl,
            timestamp: new Date().toISOString(),
            reason: `Application process exceeded 30 seconds - apply button not found`
          });
          await this.saveFailedApplications();
        }
        
        // Close the job tab and switch back to main page
        if (this.context && this.context.pages().length > 1) {
          if (this.page) {
            await this.page.close();
          }
          const pages = this.context.pages();
          const mainPage = pages.length > 0 ? pages[0] : undefined;
          if (mainPage && !mainPage.isClosed()) {
            this.page = mainPage;
            if (this.page) {
              await this.page.bringToFront();
            }
          }
        }
        return false;
      }

      // Handle cookie modal if present before applying
      await this.handleCookieModal();

      // Click apply button to open application form
      await applyButton.click();
      await this.page.waitForTimeout(2000);
      console.log('   ✅ Clicked apply button');

      // Check if we've exceeded 30 seconds
      const elapsedTimeAfterApply = Date.now() - applicationStartTime;
      if (elapsedTimeAfterApply >= maxApplicationTime) {
        const jobUrl = this.page.url();
        console.log(`   ⏱️  Application process exceeded 30 seconds (${Math.round(elapsedTimeAfterApply / 1000)}s), marking as failed`);
        this.failedApplications.push({
          jobTitle: jobTitle,
          url: jobUrl,
          timestamp: new Date().toISOString(),
          reason: `Application process exceeded 30 seconds after clicking apply button`
        });
        await this.saveFailedApplications();
        return false;
      }

      // Wait for application form to appear
      console.log('   📋 Application form opened');
      console.log('   ⏳ Waiting for form to fully load...');
      await this.page.waitForTimeout(3000);

      // Handle cookie modal again in case it appears after navigation
      await this.handleCookieModal();
      
      // Check again after form load
      const elapsedTimeAfterFormLoad = Date.now() - applicationStartTime;
      if (elapsedTimeAfterFormLoad >= maxApplicationTime) {
        const jobUrl = this.page.url();
        console.log(`   ⏱️  Application process exceeded 30 seconds (${Math.round(elapsedTimeAfterFormLoad / 1000)}s), marking as failed`);
        this.failedApplications.push({
          jobTitle: jobTitle,
          url: jobUrl,
          timestamp: new Date().toISOString(),
          reason: `Application process exceeded 30 seconds after form loaded`
        });
        await this.saveFailedApplications();
        return false;
      }

      // Fill required text boxes using OpenAI
      await this.fillRequiredTextFields();

      // Check and tick all required checkboxes and dropdowns
      console.log('   ☑️  Checking required checkboxes and dropdowns...');
      try {
        const checkboxSelectors = [
          'input[type="checkbox"][required]',
          'input[type="checkbox"]:not([checked])',
          'input[type="checkbox"][aria-required="true"]',
        ];

        for (const selector of checkboxSelectors) {
          try {
            const checkboxes = await this.page.$$(selector);
            for (const checkbox of checkboxes) {
              try {
                const isChecked = await checkbox.isChecked();
                const isRequired = await checkbox.evaluate((el) => {
                  return el.hasAttribute('required') || 
                         el.getAttribute('aria-required') === 'true' ||
                         el.closest('label')?.textContent?.includes('*') ||
                         el.closest('.required') !== null;
                });
                
                if (!isChecked && isRequired) {
                  await checkbox.check();
                  console.log('   ✅ Checked required checkbox');
                  await this.page.waitForTimeout(500);
                }
              } catch (e) {
                continue;
              }
            }
          } catch (e) {
            continue;
          }
        }

        // Handle ALL dropdowns (both native select and custom dropdowns) - use basic matching first, then AI if needed
        console.log('   📋 Checking all dropdown selects...');
        
        // First, handle native <select> elements
        const nativeSelects = await this.page.$$('select');
        for (const select of nativeSelects) {
          try {
            // Extract question/label for this dropdown
            const fieldInfo = await select.evaluate((el) => {
              const selectEl = el as HTMLSelectElement;
              const id = selectEl.id;
              const name = selectEl.name;
              
              // Find label
              let labelText = '';
              if (id) {
                const label = document.querySelector(`label[for="${id}"]`);
                if (label) {
                  labelText = label.textContent?.trim() || '';
                }
              }
              if (!labelText) {
                const parentLabel = selectEl.closest('label');
                if (parentLabel) {
                  labelText = parentLabel.textContent?.trim() || '';
                }
              }
              if (!labelText) {
                const prevLabel = selectEl.previousElementSibling;
                if (prevLabel && prevLabel.tagName === 'LABEL') {
                  labelText = prevLabel.textContent?.trim() || '';
                }
              }
              // Try to find label in parent container
              if (!labelText) {
                const parent = selectEl.parentElement;
                if (parent) {
                  const labelInParent = parent.querySelector('label');
                  if (labelInParent) {
                    labelText = labelInParent.textContent?.trim() || '';
                  }
                }
              }

              return {
                id,
                name,
                label: labelText,
              };
            });

            const questionText = fieldInfo.label || fieldInfo.name || 'dropdown question';
            
            // Skip common fields that are usually already filled (no need to process or pass to AI)
            const isCommonField = /^(first\s*name|last\s*name|email|phone|country)$/i.test(questionText) ||
              (fieldInfo.id && /^(first|last|email|phone|country)/i.test(fieldInfo.id)) ||
              (fieldInfo.name && /^(first|last|email|phone|country)/i.test(fieldInfo.name));
            
            if (isCommonField) {
              console.log(`   ⏭️  Skipping common field (should already be filled): ${questionText}`);
              continue;
            }
            
            // Skip country-related dropdowns as they should already be filled
            const isCountryField = 
              /country|nation|location\s*$/i.test(questionText) ||
              (fieldInfo.id && /country|nation/i.test(fieldInfo.id)) ||
              (fieldInfo.name && /country|nation/i.test(fieldInfo.name));
            
            if (isCountryField) {
              console.log(`   ⏭️  Skipping country dropdown (should already be filled): ${questionText}`);
              continue;
            }
            
            // Check if already has a value selected (before clicking)
            const currentValue = await select.evaluate((el: HTMLSelectElement) => {
              const value = el.value;
              const selectedOption = el.options[el.selectedIndex];
              const selectedText = selectedOption ? selectedOption.textContent?.trim() : '';
              return { value, selectedText };
            });
            
            // Skip if already filled (has a valid value and not a placeholder)
            if (currentValue.value && 
                currentValue.value !== '' && 
                currentValue.value !== '0' && 
                currentValue.value !== '-1' &&
                currentValue.selectedText &&
                !/select|choose|please|--|none|empty|^$|^\s*$/i.test(currentValue.selectedText)) {
              console.log(`   ⏭️  Skipping dropdown (already filled): ${questionText} = ${currentValue.selectedText}`);
              continue;
            }
            
            // Always click into dropdown first
            try {
              await select.click();
              await this.page.waitForTimeout(300);
              console.log(`   ✅ Clicked into native dropdown: ${questionText}`);
            } catch (e) {
              // Continue even if click fails
            }
            
            // Get all options
            const options = await select.$$eval('option', (opts) =>
              opts.map((opt) => ({ 
                value: opt.value, 
                text: opt.textContent?.trim() || '',
                index: opt.index
              }))
            );
            
            // Skip empty/placeholder options
            const validOptions = options.filter(opt => 
              opt.value && 
              opt.value !== '' && 
              opt.value !== '0' && 
              opt.value !== '-1' &&
              !/select|choose|please|--|none|empty|^$|^\s*$/.test(opt.text)
            );
            
            if (validOptions.length === 0) {
              continue;
            }
            
            // Try basic matching first (no AI needed)
            let optionToSelect: { value: string; text: string } | null = null;
            let usedAI = false;
            const basicMatchValue = this.getBasicDropdownAnswer(questionText, validOptions);
            
            if (basicMatchValue) {
              // Found a basic match
              optionToSelect = validOptions.find(opt => opt.value === basicMatchValue) || null;
            } else {
              // Use AI only if basic matching didn't work
              usedAI = true;
              console.log(`   🤖 Analyzing question with AI: ${questionText}`);
              const aiAnswer = await this.generateYesNoAnswer(questionText);
              console.log(`   💡 AI determined answer: ${aiAnswer}`);
              
              // Look for matching option (yes or no) in dropdown
              const matchingOption = validOptions.find(opt => {
                const optTextLower = opt.text.toLowerCase();
                const optValueLower = opt.value.toLowerCase();
                
                if (aiAnswer === 'yes') {
                  return /^yes$/i.test(optTextLower) || 
                         /^yes$/i.test(optValueLower) ||
                         /^y$/i.test(optTextLower) ||
                         /^y$/i.test(optValueLower) ||
                         /\byes\b/i.test(optTextLower);
                } else {
                  return /^no$/i.test(optTextLower) || 
                         /^no$/i.test(optValueLower) ||
                         /^n$/i.test(optTextLower) ||
                         /^n$/i.test(optValueLower) ||
                         /\bno\b/i.test(optTextLower);
                }
              });
              
              optionToSelect = matchingOption || validOptions[0];
            }
            
            if (optionToSelect && optionToSelect.value) {
              // Skip if already selected
              if (currentValue.value === optionToSelect.value) {
                console.log(`   ℹ️  Dropdown already has "${optionToSelect.text}" selected`);
                continue;
              }
              
              // Try multiple methods to select
              try {
                await select.selectOption(optionToSelect.value);
                console.log(`   ✅ Selected option: ${optionToSelect.text}${usedAI ? ` (AI)` : ` (basic match)`}`);
              } catch (e) {
                // Fallback: use JavaScript to set value
                try {
                  await select.evaluate((el: HTMLSelectElement, val: string) => {
                    el.value = val;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                  }, optionToSelect.value);
                  console.log(`   ✅ Selected option via JS: ${optionToSelect.text}${usedAI ? ` (AI)` : ` (basic match)`}`);
                } catch (e2) {
                  // Last resort: click and select
                  try {
                    await select.click();
                    await this.page.waitForTimeout(300);
                    const optionElement = await select.$(`option[value="${optionToSelect.value}"]`);
                    if (optionElement) {
                      await optionElement.click();
                      console.log(`   ✅ Selected option via click: ${optionToSelect.text}${usedAI ? ` (AI)` : ` (basic match)`}`);
                    }
                  } catch (e3) {
                    console.warn(`   ⚠️  Could not select option: ${optionToSelect.text}`);
                  }
                }
              }
              await this.page.waitForTimeout(500);
            }
          } catch (e) {
            continue;
          }
        }

        // Now handle custom dropdowns (divs/buttons with "Select..." text or similar)
        console.log('   📋 Checking custom dropdowns...');
        
        // Find custom dropdown triggers (buttons/divs that contain "Select" or are near required fields)
        const customDropdownSelectors = [
          'button:has-text("Select")',
          'button:has-text("Select...")',
          'div:has-text("Select")',
          'div:has-text("Select...")',
          '[role="button"]:has-text("Select")',
          '[role="combobox"]',
          '[aria-haspopup="listbox"]',
          'button[aria-expanded]',
          'div[aria-expanded]',
        ];

        // Also find elements near required labels
        const requiredLabels = await this.page.$$('label:has-text("*"), label[class*="required"], label[aria-required="true"]');
        for (const label of requiredLabels) {
          try {
            const labelText = await label.textContent();
            if (!labelText || !labelText.includes('*')) continue;
            
            // Find associated dropdown trigger (button/div after the label)
            const labelId = await label.getAttribute('for');
            let dropdownTrigger = null;
            
            if (labelId) {
              // Try to find element with matching id
              dropdownTrigger = await this.page.$(`#${labelId}, [id="${labelId}"]`).catch(() => null);
            }
            
            // If not found, look for button/div in the same container or after the label
            if (!dropdownTrigger) {
              const parent = await label.evaluateHandle((el) => el.parentElement);
              if (parent) {
                dropdownTrigger = await parent.asElement()?.$('button, div[role="button"], div[role="combobox"], [aria-haspopup="listbox"]').catch(() => null);
              }
            }
            
            // Try finding element after label
            if (!dropdownTrigger) {
              dropdownTrigger = await label.evaluateHandle((el) => {
                let next = el.nextElementSibling;
                while (next) {
                  if (next.tagName === 'BUTTON' || 
                      next.getAttribute('role') === 'button' || 
                      next.getAttribute('role') === 'combobox' ||
                      next.getAttribute('aria-haspopup') === 'listbox') {
                    return next;
                  }
                  next = next.nextElementSibling;
                }
                return null;
              }).then(handle => handle?.asElement()).catch(() => null);
            }
            
            if (dropdownTrigger) {
              try {
                const triggerText = await dropdownTrigger.textContent();
                const trimmedTriggerText = triggerText ? triggerText.trim() : '';
                const isSelectPlaceholder = trimmedTriggerText && (/select/i.test(trimmedTriggerText) || trimmedTriggerText === '');
                
                // Extract question text from label
                const questionText = labelText.replace(/\*/g, '').trim();
                
                // Skip common fields that are usually already filled (no need to process or pass to AI)
                const isCommonField = /^(first\s*name|last\s*name|email|phone|country)$/i.test(questionText);
                
                if (isCommonField) {
                  console.log(`   ⏭️  Skipping common field (should already be filled): ${questionText}`);
                  continue;
                }
                
                // Check if this is a country-related dropdown (should already be filled)
                const dropdownId = await dropdownTrigger.getAttribute('id').catch(() => null);
                const dropdownName = await dropdownTrigger.getAttribute('name').catch(() => null);
                const dropdownClass = await dropdownTrigger.getAttribute('class').catch(() => null);
                
                const isCountryField = 
                  /country|nation|location\s*$/i.test(questionText) ||
                  (dropdownId && /country|nation/i.test(dropdownId)) ||
                  (dropdownName && /country|nation/i.test(dropdownName)) ||
                  (dropdownClass && /country|nation/i.test(dropdownClass)) ||
                  (trimmedTriggerText && /country|nation/i.test(trimmedTriggerText));
                
                if (isCountryField) {
                  console.log(`   ⏭️  Skipping country dropdown (should already be filled): ${questionText}`);
                  continue;
                }
                
                // Skip if already filled (has a value that's not "Select..." or empty)
                if (!isSelectPlaceholder && trimmedTriggerText && trimmedTriggerText !== '') {
                  // Check if it's not a placeholder value
                  const isPlaceholderValue = /select|choose|please|--|none|empty/i.test(trimmedTriggerText);
                  if (!isPlaceholderValue) {
                    console.log(`   ⏭️  Skipping custom dropdown (already filled): ${questionText} = ${trimmedTriggerText}`);
                    continue;
                  }
                }
                
                // Only process if it's a placeholder or empty
                if (!isSelectPlaceholder && trimmedTriggerText !== '') {
                  continue; // Skip if it has some value that we don't recognize
                }
                
                console.log(`   🔍 Found custom dropdown for: ${questionText}`);
                
                // Scroll into view
                await dropdownTrigger.scrollIntoViewIfNeeded().catch(() => {});
                await this.page.waitForTimeout(200);
                
                // Click to open dropdown
                try {
                  await dropdownTrigger.click({ timeout: 2000 });
                  await this.page.waitForTimeout(500);
                  console.log(`   ✅ Clicked custom dropdown: ${questionText}`);
                } catch (e) {
                  // Try force click
                  try {
                    await dropdownTrigger.click({ force: true, timeout: 2000 });
                    await this.page.waitForTimeout(500);
                    console.log(`   ✅ Clicked custom dropdown (force): ${questionText}`);
                  } catch (e2) {
                    console.warn(`   ⚠️  Could not click custom dropdown: ${questionText}, skipping...`);
                    continue; // Skip this dropdown if we couldn't click it
                  }
                }
                
                // Find options in the opened dropdown menu
                const optionSelectors = [
                  '[role="option"]',
                  '[role="menuitem"]',
                  'li[role="option"]',
                  'div[role="option"]',
                  '.dropdown-item',
                  '[class*="option"]',
                  '[class*="menu-item"]',
                  'li',
                  'div[data-value]',
                ];
                
                // Collect all options first
                const allOptions: Array<{ element: any; text: string; value: string }> = [];
                for (const optSelector of optionSelectors) {
                  try {
                    const options = await this.page.$$(optSelector);
                    for (const option of options) {
                      const optionText = await option.textContent();
                      if (!optionText || optionText.trim() === '') continue;
                      
                      const dataValue = await option.getAttribute('data-value').catch(() => null);
                      const value = dataValue || optionText.trim();
                      
                      allOptions.push({
                        element: option,
                        text: optionText.trim(),
                        value: value,
                      });
                    }
                  } catch (e) {
                    continue;
                  }
                }
                
                if (allOptions.length === 0) {
                  console.warn(`   ⚠️  No options found in custom dropdown: ${questionText}`);
                  continue;
                }
                
                // Try basic matching first (no AI needed)
                const basicMatchValue = this.getBasicDropdownAnswer(questionText, allOptions.map(opt => ({ text: opt.text, value: opt.value })));
                let selectedOption: any = null;
                let selectedOptionText = '';
                let usedAI = false;
                
                if (basicMatchValue) {
                  // Found a basic match
                  const matched = allOptions.find(opt => opt.value === basicMatchValue);
                  if (matched) {
                    selectedOption = matched.element;
                    selectedOptionText = matched.text;
                  }
                } else {
                  // Use AI only if basic matching didn't work
                  usedAI = true;
                  console.log(`   🤖 Analyzing question with AI: ${questionText}`);
                  const aiAnswer = await this.generateYesNoAnswer(questionText);
                  console.log(`   💡 AI determined answer: ${aiAnswer}`);
                  
                  // Find matching option
                  for (const opt of allOptions) {
                    const optTextLower = opt.text.toLowerCase().trim();
                    const matches = aiAnswer === 'yes' 
                      ? /^yes$/i.test(optTextLower) || /\byes\b/i.test(optTextLower)
                      : /^no$/i.test(optTextLower) || /\bno\b/i.test(optTextLower);
                    
                    if (matches) {
                      selectedOption = opt.element;
                      selectedOptionText = opt.text;
                      break;
                    }
                  }
                  
                  // If no exact match, try to find first option with yes/no
                  if (!selectedOption) {
                    for (const opt of allOptions) {
                      const optTextLower = opt.text.toLowerCase().trim();
                      if (/yes|no/i.test(optTextLower)) {
                        selectedOption = opt.element;
                        selectedOptionText = opt.text;
                        break;
                      }
                    }
                  }
                }
                
                // Click the selected option
                if (selectedOption) {
                  try {
                    await selectedOption.click({ timeout: 2000 });
                    console.log(`   ✅ Selected custom dropdown option: ${selectedOptionText}${usedAI ? ` (AI answer)` : ` (basic match)`}`);
                    await this.page.waitForTimeout(500);
                  } catch (e) {
                    // Try JavaScript click
                    await selectedOption.evaluate((el: HTMLElement) => el.click());
                    console.log(`   ✅ Selected custom dropdown option via JS: ${selectedOptionText}${usedAI ? ` (AI answer)` : ` (basic match)`}`);
                    await this.page.waitForTimeout(500);
                  }
                } else {
                  console.warn(`   ⚠️  Could not find matching option in custom dropdown: ${questionText}`);
                }
              } catch (e) {
                console.warn(`   ⚠️  Error handling custom dropdown: ${e}`);
              }
            }
          } catch (e) {
            continue;
          }
        }

        // Also check for checkboxes by looking at labels with asterisks or "required" text
        const allCheckboxes = await this.page.$$('input[type="checkbox"]');
        for (const checkbox of allCheckboxes) {
          try {
            const isChecked = await checkbox.isChecked();
            if (!isChecked) {
              // Check if the label indicates it's required
              const label = await checkbox.evaluateHandle((el) => {
                const id = el.id;
                if (id) {
                  return document.querySelector(`label[for="${id}"]`);
                }
                return el.closest('label') || el.parentElement?.closest('label');
              });
              
              const labelElement = label.asElement();
              if (labelElement) {
                const labelText = await labelElement.textContent();
                if (labelText && (labelText.includes('*') || /required/i.test(labelText))) {
                  await checkbox.check();
                  console.log('   ✅ Checked required checkbox (found via label)');
                  await this.page.waitForTimeout(500);
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        console.warn('   ⚠️  Error checking checkboxes:', error);
      }

      // Scroll down to find submit button
      console.log('   📜 Scrolling down to find submit button...');
      try {
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await this.page.waitForTimeout(1000);
        
        // Scroll back up a bit to ensure button is visible
        await this.page.evaluate(() => {
          window.scrollBy(0, -200);
        });
        await this.page.waitForTimeout(500);
      } catch (e) {
        // Continue even if scrolling fails
      }

      // Find and click the submit button
      console.log('   🔍 Looking for submit button...');
      const submitSelectors = [
        'button[type="submit"]:has-text("Submit")',
        'button:has-text("Submit Application")',
        'button:has-text("Submit")',
        'button[type="submit"]',
        'input[type="submit"]',
        'button[class*="submit"]',
        'button[class*="apply"]:has-text("Submit")',
        '[data-testid*="submit"]',
      ];

      let submitButton = null;
      for (const selector of submitSelectors) {
        try {
          submitButton = await this.page.$(selector);
          if (submitButton) {
            const buttonText = await submitButton.textContent();
            console.log(`   ✅ Found submit button: ${buttonText?.trim()}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      // Helper function to trigger auto-fill
      const triggerAutofill = async (): Promise<boolean> => {
        if (!this.page) {
          return false;
        }

        // First, try clicking into a text input to trigger auto-fill
        console.log('   📝 Attempting to trigger auto-fill...');
        try {
          const textBoxSelectors = [
            'input[type="text"]',
            'input[type="email"]',
            'textarea',
            'input[name*="name"]',
            'input[name*="email"]',
            'input[class*="input"]',
            '[contenteditable="true"]',
          ];

          let fieldsPopulated = false;
          for (const selector of textBoxSelectors) {
            try {
              const textBox = await this.page.$(selector);
              if (textBox) {
                await textBox.click();
                await this.page.waitForTimeout(1000);
                
                // Check if any fields got populated
                const allInputs = await this.page.$$('input[type="text"], input[type="email"], textarea');
                let filledCount = 0;
                for (const input of allInputs.slice(0, 5)) {
                  try {
                    const value = await input.inputValue();
                    if (value && value.trim().length > 0) {
                      filledCount++;
                    }
                  } catch (e) {
                    continue;
                  }
                }
                
                if (filledCount > 0) {
                  console.log(`   ✅ Auto-fill triggered (${filledCount} fields populated)`);
                  fieldsPopulated = true;
                  break;
                }
              }
            } catch (e) {
              continue;
            }
          }

          // If fields didn't populate, try clicking the "Autofill with MyGreenhouse" button
          if (!fieldsPopulated) {
            console.log('   📝 Trying "Autofill with MyGreenhouse" button...');
            const autofillButtonSelectors = [
              'button:has-text("Autofill with MyGreenhouse")',
              'a:has-text("Autofill with MyGreenhouse")',
              '[role="button"]:has-text("Autofill with MyGreenhouse")',
              'button[class*="autofill" i]',
              'a[class*="autofill" i]',
              'button[id*="autofill" i]',
              'a[id*="autofill" i]',
            ];

            for (const selector of autofillButtonSelectors) {
              try {
                const autofillButton = await this.page.$(selector);
                if (autofillButton) {
                  const buttonText = await autofillButton.textContent();
                  if (buttonText && buttonText.includes('Autofill with MyGreenhouse')) {
                    const isVisible = await autofillButton.isVisible().catch(() => false);
                    if (isVisible) {
                      await autofillButton.scrollIntoViewIfNeeded().catch(() => {});
                      await this.page.waitForTimeout(200);
                      
                      try {
                        await autofillButton.click({ timeout: 2000 });
                      } catch (e) {
                        await autofillButton.evaluate((btn: HTMLElement) => {
                          (btn as HTMLElement).click();
                        });
                      }
                      
                      await this.page.waitForTimeout(1000);
                      console.log('   ✅ Clicked "Autofill with MyGreenhouse" button');
                      return true;
                    }
                  }
                }
              } catch (e) {
                continue;
              }
            }

            // Fallback: Try using evaluate
            try {
              const clicked = await this.page.evaluate(() => {
                const allButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
                const autofillButton = allButtons.find((btn: Element) => {
                  const text = btn.textContent || '';
                  return text.includes('Autofill with MyGreenhouse');
                });

                if (autofillButton) {
                  const style = window.getComputedStyle(autofillButton as HTMLElement);
                  if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                    (autofillButton as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              });

              if (clicked) {
                await this.page.waitForTimeout(1000);
                console.log('   ✅ Clicked "Autofill with MyGreenhouse" button (via evaluate)');
                return true;
              }
            } catch (e) {
              // Silently continue
            }
          } else {
            return true;
          }
        } catch (error) {
          console.warn('   ⚠️  Error triggering auto-fill:', error);
        }
        return false;
      };

      let submissionSuccessful = false;
      
      if (!submitButton) {
        console.warn('   ⚠️  Submit button not found, trying to fill required inputs and retry...');
        
        // Try to fill any required inputs that might be missing
        try {
          const requiredInputs = await this.page.$$('input[required]:not([value]), textarea[required]:not([value]), select[required]');
          for (const input of requiredInputs.slice(0, 5)) {
            try {
              const tagName = await input.evaluate((el) => el.tagName.toLowerCase());
              if (tagName === 'select') {
                // Already handled in dropdown section, but try clicking again
                await input.click();
                await this.page.waitForTimeout(300);
              } else {
                // Try clicking into text inputs
                await input.click();
                await this.page.waitForTimeout(300);
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          // Continue even if filling fails
        }
        
        const autofillTriggered = await triggerAutofill();
        if (autofillTriggered) {
          // Wait a bit for form to update
          await this.page.waitForTimeout(2000);
        }
        
        // Scroll down again to find submit button
        try {
          await this.page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
          });
          await this.page.waitForTimeout(1000);
        } catch (e) {
          // Continue even if scrolling fails
        }
        
        // Try finding submit button again
        for (const selector of submitSelectors) {
          try {
            submitButton = await this.page.$(selector);
            if (submitButton) {
              const buttonText = await submitButton.textContent();
              console.log(`   ✅ Found submit button after filling required inputs: ${buttonText?.trim()}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }
        
        if (!submitButton) {
          console.log('   ⚠️  Submit button still not found, form may auto-submit or need manual submission');
          // Wait a bit more in case form auto-submits
          await this.page.waitForTimeout(3000);
          
          // Check if form auto-submitted by looking for success indicators
          try {
            const successConfirmed = await this.waitForSubmissionSuccess(5000);
            
            if (successConfirmed) {
              submissionSuccessful = true;
              console.log('   ✅ Application auto-submitted successfully');
            } else {
              console.log('   ⚠️  Could not confirm auto-submission, assuming success');
              submissionSuccessful = true; // Assume success if no submit button found
            }
          } catch (error) {
            console.warn('   ⚠️  Could not confirm auto-submission');
            submissionSuccessful = true; // Assume success
          }
        } else {
          // Found submit button after retry, continue to click it below
        }
      }
      
      if (submitButton) {
        // Click submit button
        console.log('   📤 Clicking submit button...');
        await submitButton.click();
        await this.page.waitForTimeout(2000);
        
        // Wait for submission confirmation with 1 minute timeout
        console.log('   ⏳ Waiting for submission confirmation (max 1 minute)...');
        const submissionStartTime = Date.now();
        const timeoutMs = 60000; // 1 minute
        
        try {
          // Use helper method to wait for success confirmation
          submissionSuccessful = await this.waitForSubmissionSuccess(timeoutMs);
          
          if (submissionSuccessful) {
            await this.page.waitForTimeout(2000);
            console.log('   ✅ Application submitted successfully');
          }
        } catch (error) {
          const elapsedTime = Date.now() - submissionStartTime;
          
          // If submission didn't work, try triggering auto-fill and resubmit
          if (elapsedTime < timeoutMs) {
            console.log('   ⚠️  Submission may have failed, trying to trigger auto-fill and resubmit...');
            const autofillTriggered = await triggerAutofill();
            
            if (autofillTriggered) {
              await this.page.waitForTimeout(2000);
              
              // Try clicking submit button again
              try {
                const submitButtonRetry = await this.page.$(submitSelectors[0]).catch(() => null) ||
                                         await this.page.$(submitSelectors[1]).catch(() => null) ||
                                         await this.page.$(submitSelectors[2]).catch(() => null);
                
                if (submitButtonRetry) {
                  console.log('   📤 Retrying submit after auto-fill...');
                  await submitButtonRetry.click();
                  await this.page.waitForTimeout(3000);
                  
                  // Check again for success
                  try {
                    const retrySuccess = await this.waitForSubmissionSuccess(10000);
                    if (retrySuccess) {
                      submissionSuccessful = true;
                      console.log('   ✅ Application submitted successfully after auto-fill');
                    }
                  } catch (e) {
                    // Still didn't work
                  }
                }
              } catch (e) {
                // Couldn't retry submit
              }
            }
          }
          
          if (!submissionSuccessful) {
            if (elapsedTime >= timeoutMs) {
              console.log('   ⏱️  Submission timeout after 1 minute');
              submissionSuccessful = false;
              
              // Record failed submission
              const jobUrl = this.page.url();
              this.failedSubmissions.push({
                jobTitle: jobTitle,
                url: jobUrl,
                timestamp: new Date().toISOString(),
                reason: 'Submission timeout after 1 minute'
              });
              
              // Write to JSON file
              await this.saveFailedSubmissions();
            } else {
              console.warn('   ⚠️  Could not confirm submission');
              // Check for error messages
              try {
                const errorMessages = await this.page.$$('text=/error|invalid|required|missing/i');
                if (errorMessages.length > 0) {
                  console.log('   ❌ Error messages found, submission may have failed');
                  submissionSuccessful = false;
                  
                  // Record failed submission
                  const jobUrl = this.page.url();
                  this.failedSubmissions.push({
                    jobTitle: jobTitle,
                    url: jobUrl,
                    timestamp: new Date().toISOString(),
                    reason: 'Error messages found on page'
                  });
                  
                  // Write to JSON file
                  await this.saveFailedSubmissions();
                } else {
                  submissionSuccessful = true; // Assume success if no errors found
                }
              } catch (e) {
                submissionSuccessful = true; // Assume success on error
              }
            }
          }
        }
      }
      
      // Only switch back to main page after successful submission
      if (submissionSuccessful) {
        if (this.context && this.context.pages().length > 1) {
          if (this.page) {
            await this.page.close();
          }
          const pages = this.context.pages();
          const mainPage = pages.length > 0 ? pages[0] : undefined;
          if (mainPage && !mainPage.isClosed()) {
            this.page = mainPage;
            if (this.page) {
              await this.page.bringToFront();
              console.log('   🔙 Switched back to main jobs page');
            }
          }
        }
        return true;
      } else {
        console.log('   ❌ Submission unsuccessful, keeping tab open for manual review');
        
        // Record failed submission if not already recorded
        const alreadyRecorded = this.failedSubmissions.some(f => f.jobTitle === jobTitle);
        if (!alreadyRecorded) {
          const jobUrl = this.page ? this.page.url() : 'unknown';
          this.failedSubmissions.push({
            jobTitle: jobTitle,
            url: jobUrl,
            timestamp: new Date().toISOString(),
            reason: 'Submission unsuccessful - no success confirmation'
          });
          
          // Write to JSON file
          await this.saveFailedSubmissions();
        }
        
        return false;
      }
    } catch (error) {
      console.error(`   ❌ Error in application process: ${error}`);
      
      // Check if we exceeded 30 seconds
      const elapsedTime = Date.now() - applicationStartTime;
      if (elapsedTime >= maxApplicationTime) {
        const jobUrl = this.page ? this.page.url() : 'unknown';
        this.failedApplications.push({
          jobTitle: jobTitle,
          url: jobUrl,
          timestamp: new Date().toISOString(),
          reason: `Application process exceeded 30 seconds (${Math.round(elapsedTime / 1000)}s) - ${error instanceof Error ? error.message : String(error)}`
        });
        await this.saveFailedApplications();
      }
      
      return false;
    }
  }

  async applyToJob(job: Job): Promise<boolean> {
    if (!this.page || !this.context) {
      throw new Error('Page or context not initialized');
    }

    try {
      console.log(`\n📝 Processing: ${job.title}`);
      
      // Get the current number of pages before clicking
      const pagesBefore = this.context.pages();
      const initialPageCount = pagesBefore.length;
      
      // If we have a view button, click it to navigate to the job page
      if (job.viewButton) {
        console.log('   🔗 Clicking "View Job" button...');
        
        // Click the button (may open in new tab)
        await job.viewButton.click();
        await this.page.waitForTimeout(2000);
        
        // Wait for new tab to open if it opens in a new tab
        let jobPage = this.page;
        const maxWaitTime = 5000; // 5 seconds max wait
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
          const currentPages = this.context.pages();
          if (currentPages.length > initialPageCount) {
            // New tab opened, switch to it
            jobPage = currentPages[currentPages.length - 1];
            await jobPage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
            console.log('   ✅ New tab opened, switched to job page');
            break;
          }
          await this.page.waitForTimeout(500);
        }
        
        // Wait for page to load
        await jobPage.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await jobPage.waitForTimeout(1000);
        
        // Use the job page for finding apply button
        this.page = jobPage;
        
        // Handle cookie modal immediately after page load
        await this.handleCookieModal();
        
        await this.page.waitForTimeout(1000);
      } else if (job.href && !job.href.startsWith('job-')) {
        // Fallback: navigate directly if we have a URL
        await this.page.goto(job.href, { waitUntil: 'networkidle' });
        await this.page.waitForTimeout(1000);
        
        // Handle cookie modal immediately after page load
        await this.handleCookieModal();
        
        await this.page.waitForTimeout(1000);
      } else {
        console.log('   ⚠️  No view button or URL found, skipping...');
        return false;
      }

      // Use the extracted application logic
      return await this.performJobApplication(job.title);
    } catch (error) {
      console.error(`   ❌ Error applying to job: ${error}`);
      return false;
    }
  }

  async saveFailedSubmissions(): Promise<void> {
    if (this.failedSubmissions.length === 0) return;

    try {
      const { storage } = await import('./storage.js');
      const jobs = this.failedSubmissions.map(job => ({
        ...job,
        type: 'submission' as const,
      }));
      await storage.saveBatch(jobs);
      console.log(`   💾 Saved ${this.failedSubmissions.length} failed submission(s)`);
    } catch (error) {
      console.warn('   ⚠️  Could not save failed submissions:', error);
    }
  }

  async saveFailedApplications(): Promise<void> {
    if (this.failedApplications.length === 0) return;

    try {
      const { storage } = await import('./storage.js');
      const jobs = this.failedApplications.map(job => ({
        ...job,
        type: 'application' as const,
      }));
      await storage.saveBatch(jobs);
      console.log(`   💾 Saved ${this.failedApplications.length} failed application(s)`);
    } catch (error) {
      console.warn('   ⚠️  Could not save failed applications:', error);
    }
  }

  async handleCookieModal(): Promise<void> {
    if (!this.page) {
      return;
    }

    try {
      // Wait a bit for modal to appear (but not too long)
      await this.page.waitForTimeout(500);

      // First, try to find and click cookie consent buttons directly
      const cookieButtonSelectors = [
        'button:has-text("Accept All")',
        'button:has-text("Accept all")',
        'a:has-text("Accept All")',
        'a:has-text("Accept all")',
        'button:has-text("Accept")',
        'a:has-text("Accept")',
        '[role="button"]:has-text("Accept All")',
        '[role="button"]:has-text("Accept")',
        'button[id*="accept" i]',
        'button[class*="accept" i]',
        'button[class*="cookie" i]:has-text("Accept")',
        '[data-testid*="accept" i]',
        '[data-testid*="cookie" i]:has-text("Accept")',
      ];

      for (const selector of cookieButtonSelectors) {
        try {
          const cookieButton = await this.page.$(selector);
          if (cookieButton) {
            const isVisible = await cookieButton.isVisible().catch(() => false);
            if (isVisible) {
              // Scroll button into view if needed
              await cookieButton.scrollIntoViewIfNeeded().catch(() => {});
              await this.page.waitForTimeout(200);
              
              // Try clicking with multiple methods
              try {
                await cookieButton.click({ timeout: 2000 });
              } catch (e) {
                // Fallback: use JavaScript click
                await cookieButton.evaluate((btn: HTMLElement) => {
                  (btn as HTMLElement).click();
                });
              }
              
              await this.page.waitForTimeout(500);
              console.log('   🍪 Clicked cookie accept button');
              
              // Wait a bit more and check if modal disappeared
              await this.page.waitForTimeout(300);
              return; // Successfully handled
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Also try to find modal/dialog and look for accept button inside
      const modalSelectors = [
        '[role="dialog"]',
        '[class*="modal" i]',
        '[class*="cookie" i]',
        '[class*="consent" i]',
        '[id*="cookie" i]',
        '[id*="consent" i]',
        '[class*="banner" i]',
        '[class*="overlay" i]',
      ];

      for (const modalSelector of modalSelectors) {
        try {
          const modal = await this.page.$(modalSelector);
          if (modal) {
            const isVisible = await modal.isVisible().catch(() => false);
            if (isVisible) {
              // Look for accept button within the modal (prioritize "Accept All")
              const acceptAllButton = await modal.$('button:has-text("Accept All"), a:has-text("Accept All"), button:has-text("Accept all"), a:has-text("Accept all")').catch(() => null);
              const acceptButton = acceptAllButton || await modal.$('button:has-text("Accept"), a:has-text("Accept")').catch(() => null);
              
              if (acceptButton || acceptAllButton) {
                const buttonToClick = acceptAllButton || acceptButton;
                if (buttonToClick) {
                  // Scroll button into view
                  await buttonToClick.scrollIntoViewIfNeeded().catch(() => {});
                  await this.page.waitForTimeout(200);
                  
                  try {
                    await buttonToClick.click({ timeout: 2000 });
                  } catch (e) {
                    // Fallback: use JavaScript click
                    await buttonToClick.evaluate((btn: HTMLElement) => {
                      (btn as HTMLElement).click();
                    });
                  }
                  
                  await this.page.waitForTimeout(500);
                  console.log('   🍪 Clicked cookie accept button in modal');
                  
                  // Wait a bit more and check if modal disappeared
                  await this.page.waitForTimeout(300);
                  return;
                }
              }
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Try using evaluate to find and click any cookie consent elements
      try {
        const clicked = await this.page.evaluate(() => {
          // Look for common cookie consent text patterns
          const allButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          const cookieButtons = allButtons.filter((btn: Element) => {
            const text = btn.textContent?.toLowerCase() || '';
            return text.includes('accept') && (
              text.includes('all') || 
              text.includes('cookie') || 
              text.includes('consent') ||
              btn.closest('[class*="cookie" i]') !== null ||
              btn.closest('[class*="consent" i]') !== null ||
              btn.closest('[id*="cookie" i]') !== null ||
              btn.closest('[id*="consent" i]') !== null
            );
          });

          if (cookieButtons.length > 0) {
            // Prefer "Accept All" over "Accept"
            const acceptAll = cookieButtons.find((btn: Element) => 
              btn.textContent?.toLowerCase().includes('all')
            );
            const buttonToClick = acceptAll || cookieButtons[0];
            
            // Check if visible
            const style = window.getComputedStyle(buttonToClick as HTMLElement);
            if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
              (buttonToClick as HTMLElement).click();
              return true;
            }
          }
          return false;
        });

        if (clicked) {
          await this.page.waitForTimeout(500);
          console.log('   🍪 Clicked cookie accept button (via evaluate)');
          return;
        }
      } catch (e) {
        // Silently continue if evaluate fails
      }
    } catch (error) {
      // Silently fail - cookie modal might not be present
      // This is expected behavior - if no modal exists, we just continue
    }
  }

  async generateAnswer(question: string, fieldType: string = 'text'): Promise<string> {
    if (!this.openai) {
      return '';
    }

    try {
      // Read and extract text content from CV HTML
      const cvPath = path.join(__dirname, 'cv.html');
      let cvContent = '';
      
      try {
        const htmlContent = await fs.readFile(cvPath, 'utf-8');
        
        // Extract text content from HTML (remove HTML tags and scripts)
        // Simple approach: remove script and style tags, then extract text
        cvContent = htmlContent
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style tags
          .replace(/<[^>]+>/g, ' ') // Remove all HTML tags
          .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
          .replace(/&amp;/g, '&') // Replace &amp; with &
          .replace(/&lt;/g, '<') // Replace &lt; with <
          .replace(/&gt;/g, '>') // Replace &gt; with >
          .replace(/&quot;/g, '"') // Replace &quot; with "
          .replace(/&#39;/g, "'") // Replace &#39; with '
          .replace(/\s+/g, ' ') // Replace multiple whitespace with single space
          .trim();
        
        // Limit to reasonable length
        if (cvContent.length > 10000) {
          console.warn(`   ⚠️  CV content is very long (${cvContent.length} chars), truncating to 10000 chars`);
          cvContent = cvContent.substring(0, 10000) + '...';
        }
        
        console.log(`   📄 Extracted ${cvContent.length} characters from CV HTML`);
      } catch (error) {
        console.warn(`   ⚠️  Could not read CV HTML: ${error}`);
        // Fallback: continue without CV content
      }

      const systemPrompt = `You are a helpful assistant that helps fill out job application forms. 
Generate concise, professional answers based on the candidate's information.

CV/Resume content:
${cvContent}

Work Authorization Information:
- British citizen
- Can work anywhere (globally)
- Does NOT require sponsorship for jobs based in the UK
- Requires sponsorship to work in the United States (for non-UK positions)
- NOT a former employee or contractor

Keep answers brief (1-3 sentences for most questions, up to 100 words for longer responses).
Be professional and relevant to the question asked. Use information from the CV to answer questions about experience, skills, and background.
For work authorization questions, mention that you are a British citizen who does not require sponsorship for UK-based positions, but would require sponsorship for US positions.`;

      const userPrompt = `Field type: ${fieldType}
Question/Label: ${question}

Generate an appropriate answer for this job application field.`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 100, // Reduced from 150 to keep responses shorter
        temperature: 0.7,
      });

      let answer = completion.choices[0]?.message?.content?.trim() || '';
      
      // Limit answer length to 200 characters to prevent overly long responses
      if (answer.length > 200) {
        answer = answer.substring(0, 197) + '...';
        console.log(`   ⚠️  Truncated answer to 200 characters`);
      }
      
      // Check if the response is uncertain or unclear
      if (!answer) {
        return 'Not available';
      }
      
      // Check for uncertain phrases in the response
      const uncertainPhrases = [
        /i'm not sure/i,
        /i don't know/i,
        /i cannot/i,
        /i'm unable/i,
        /i don't have/i,
        /unclear/i,
        /uncertain/i,
        /not certain/i,
        /cannot determine/i,
        /unable to/i,
        /i'm not certain/i,
        /i'm unsure/i,
        /i don't have enough/i,
        /insufficient information/i,
        /not enough information/i,
      ];
      
      const isUncertain = uncertainPhrases.some(phrase => phrase.test(answer));
      
      if (isUncertain) {
        console.log('   ⚠️  AI response was uncertain, using "Not sure"');
        return 'Not sure';
      }
      
      // Check if response is too generic or vague (very short or just repeats the question)
      if (answer.length < 10 || answer.toLowerCase() === question.toLowerCase().substring(0, answer.length)) {
        console.log('   ⚠️  AI response was too generic, using "Not available"');
        return 'Not available';
      }
      
      return answer;
    } catch (error) {
      console.warn(`   ⚠️  Error generating answer with OpenAI: ${error}`);
      return 'Not available';
    }
  }

  /**
   * Basic matching for common dropdown questions without using AI
   * Returns the answer if matched, null if AI is needed
   */
  private getBasicDropdownAnswer(question: string, options: Array<{ text: string; value: string }>): string | null {
    const questionLower = question.toLowerCase();
    
    // Gender questions - select "man" or "male"
    if (/gender|sex|title\s*\(mr|mrs|ms\)/i.test(question)) {
      const maleOption = options.find(opt => 
        /^male$|^man$|^m$|^mr\.?$/i.test(opt.text.trim()) ||
        /male|man|mr/i.test(opt.text.toLowerCase())
      );
      if (maleOption) {
        console.log(`   ✅ Basic match: Gender -> ${maleOption.text}`);
        return maleOption.value;
      }
    }
    
    // Location/Country - select UK
    if (/location|country|nation|where do you live|reside/i.test(question)) {
      const ukOption = options.find(opt => 
        /^uk$|^united kingdom$|^great britain$|^gb$|^england$|^scotland$|^wales$/i.test(opt.text.trim()) ||
        /united kingdom|great britain|^uk\b/i.test(opt.text.toLowerCase())
      );
      if (ukOption) {
        console.log(`   ✅ Basic match: Location -> ${ukOption.text}`);
        return ukOption.value;
      }
    }
    
    // Visa sponsorship questions
    if (/visa|sponsorship|work authorization|work permit|require sponsorship/i.test(question)) {
      // Check if question mentions UK specifically
      const isUKQuestion = /uk|united kingdom|britain/i.test(question);
      
      if (isUKQuestion) {
        // For UK: no sponsorship needed
        const noOption = options.find(opt => 
          /^no$/i.test(opt.text.trim()) || /^n$/i.test(opt.text.trim()) ||
          /\bno\b/i.test(opt.text.toLowerCase())
        );
        if (noOption) {
          console.log(`   ✅ Basic match: UK Visa -> ${noOption.text}`);
          return noOption.value;
        }
      } else {
        // For non-UK countries: yes, need sponsorship (default to yes for most US-based jobs)
        const yesOption = options.find(opt => 
          /^yes$/i.test(opt.text.trim()) || /^y$/i.test(opt.text.trim()) ||
          /\byes\b/i.test(opt.text.toLowerCase())
        );
        if (yesOption) {
          console.log(`   ✅ Basic match: Visa Sponsorship (non-UK) -> ${yesOption.text}`);
          return yesOption.value;
        }
      }
    }
    
    // Former employee questions - always "no"
    if (/former|previous|ex-|prior employee|worked here before|contractor/i.test(question)) {
      const noOption = options.find(opt => 
        /^no$/i.test(opt.text.trim()) || /^n$/i.test(opt.text.trim()) ||
        /\bno\b/i.test(opt.text.toLowerCase())
      );
      if (noOption) {
        console.log(`   ✅ Basic match: Former Employee -> ${noOption.text}`);
        return noOption.value;
      }
    }
    
    // Remote work - always "yes"
    if (/remote|work from home|wfh|telecommute/i.test(question)) {
      const yesOption = options.find(opt => 
        /^yes$/i.test(opt.text.trim()) || /^y$/i.test(opt.text.trim()) ||
        /\byes\b/i.test(opt.text.toLowerCase())
      );
      if (yesOption) {
        console.log(`   ✅ Basic match: Remote Work -> ${yesOption.text}`);
        return yesOption.value;
      }
    }
    
    // Return null to indicate AI should be used
    return null;
  }

  async generateYesNoAnswer(question: string): Promise<'yes' | 'no'> {
    if (!this.openai) {
      return 'no'; // Default to "no" if OpenAI not available
    }

    try {
      // Read and extract text content from CV HTML
      const cvPath = path.join(__dirname, 'cv.html');
      let cvContent = '';
      
      try {
        const htmlContent = await fs.readFile(cvPath, 'utf-8');
        cvContent = htmlContent
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
        
        if (cvContent.length > 10000) {
          cvContent = cvContent.substring(0, 10000) + '...';
        }
      } catch (error) {
        // Continue without CV content
      }

      const systemPrompt = `You are a helpful assistant that helps fill out job application forms.
Answer questions with ONLY "yes" or "no" based on the candidate's information.

CV/Resume content:
${cvContent}

Work Authorization Information:
- British citizen
- Can work anywhere (globally)
- Does NOT require sponsorship for jobs based in the UK
- Requires sponsorship to work in the United States (for non-UK positions)
- NOT a former employee or contractor

Answer "yes" if the statement/question is true for the candidate, "no" if it's false or not applicable.
For example:
- "Do you require sponsorship?" -> "no" (for UK positions) or "yes" (for US positions)
- "Are you a former employee?" -> "no"
- "Do you have 5+ years of experience?" -> Answer based on CV
- "Can you work remotely?" -> "yes"

Respond with ONLY the word "yes" or "no", nothing else.`;

      const userPrompt = `Question/Label: ${question}

Answer with ONLY "yes" or "no".`;

      const completion = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 10,
        temperature: 0.3, // Lower temperature for more consistent yes/no answers
      });

      const answer = completion.choices[0]?.message?.content?.trim().toLowerCase() || '';
      
      // Extract yes or no from the response
      if (/^yes|^y\b/i.test(answer)) {
        return 'yes';
      } else if (/^no|^n\b/i.test(answer)) {
        return 'no';
      } else {
        // If unclear, default to "no" for safety
        console.log(`   ⚠️  AI response unclear ("${answer}"), defaulting to "no"`);
        return 'no';
      }
    } catch (error) {
      console.warn(`   ⚠️  Error generating yes/no answer with OpenAI: ${error}`);
      return 'no'; // Default to "no" on error
    }
  }

  async fillRequiredTextFields(): Promise<void> {
    if (!this.page) {
      return;
    }

    if (!this.openai) {
      console.log('   ⚠️  OpenAI not configured, skipping text field auto-fill');
      return;
    }

    try {
      console.log('   ✍️  Finding and filling required text fields...');
      
      // Find all text input fields and textareas
      const textFieldSelectors = [
        'input[type="text"][required]',
        'input[type="email"][required]',
        'textarea[required]',
        'input[required]:not([type="checkbox"]):not([type="radio"]):not([type="file"])',
        'textarea[aria-required="true"]',
        'input[aria-required="true"]:not([type="checkbox"]):not([type="radio"]):not([type="file"])',
      ];

      const filledFields: string[] = [];

      for (const selector of textFieldSelectors) {
        try {
          const fields = await this.page.$$(selector);
          for (const field of fields) {
            try {
              // Check if field is already filled
              const currentValue = await field.inputValue();
              if (currentValue && currentValue.trim().length > 0) {
                continue; // Skip already filled fields
              }

              // Get field information
              const fieldInfo = await field.evaluate((el) => {
                const input = el as HTMLInputElement | HTMLTextAreaElement;
                const id = input.id;
                const name = input.name;
                const placeholder = input.placeholder;
                const type = input.type;
                
                // Find label
                let labelText = '';
                if (id) {
                  const label = document.querySelector(`label[for="${id}"]`);
                  if (label) {
                    labelText = label.textContent?.trim() || '';
                  }
                }
                if (!labelText) {
                  const parentLabel = input.closest('label');
                  if (parentLabel) {
                    labelText = parentLabel.textContent?.trim() || '';
                  }
                }
                if (!labelText) {
                  const prevLabel = input.previousElementSibling;
                  if (prevLabel && prevLabel.tagName === 'LABEL') {
                    labelText = prevLabel.textContent?.trim() || '';
                  }
                }

                return {
                  id,
                  name,
                  placeholder,
                  type,
                  label: labelText,
                };
              });

              // Determine question text
              const questionText = fieldInfo.label || fieldInfo.placeholder || fieldInfo.name || 'text field';
              
              // Skip if we've already filled this field (by name/id)
              const fieldKey = fieldInfo.name || fieldInfo.id || questionText;
              if (filledFields.includes(fieldKey)) {
                continue;
              }

              // Generate answer using OpenAI
              console.log(`   🤖 Generating answer for: ${questionText}`);
              const answer = await this.generateAnswer(questionText, fieldInfo.type || 'text');

              if (answer) {
                await field.fill(answer);
                await this.page.waitForTimeout(500);
                filledFields.push(fieldKey);
                console.log(`   ✅ Filled field "${questionText}"`);
              } else {
                console.log(`   ⚠️  Could not generate answer for "${questionText}"`);
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          continue;
        }
      }

      // Also check for fields with asterisks in labels (common required indicator)
      try {
        const allTextFields = await this.page.$$('input[type="text"], input[type="email"], textarea');
        for (const field of allTextFields) {
          try {
            const currentValue = await field.inputValue();
            if (currentValue && currentValue.trim().length > 0) {
              continue;
            }

            // Check if label has asterisk (indicates required)
            const hasRequiredIndicator = await field.evaluate((el) => {
              const input = el as HTMLInputElement | HTMLTextAreaElement;
              const id = input.id;
              
              if (id) {
                const label = document.querySelector(`label[for="${id}"]`);
                if (label && label.textContent?.includes('*')) {
                  return true;
                }
              }
              
              const parentLabel = input.closest('label');
              if (parentLabel && parentLabel.textContent?.includes('*')) {
                return true;
              }
              
              return false;
            });

            if (hasRequiredIndicator) {
              const fieldInfo = await field.evaluate((el) => {
                const input = el as HTMLInputElement | HTMLTextAreaElement;
                const id = input.id;
                const name = input.name;
                const placeholder = input.placeholder;
                
                let labelText = '';
                if (id) {
                  const label = document.querySelector(`label[for="${id}"]`);
                  if (label) {
                    labelText = label.textContent?.trim() || '';
                  }
                }
                if (!labelText) {
                  const parentLabel = input.closest('label');
                  if (parentLabel) {
                    labelText = parentLabel.textContent?.trim() || '';
                  }
                }

                return {
                  id,
                  name,
                  placeholder,
                  label: labelText,
                };
              });

              const questionText = fieldInfo.label || fieldInfo.placeholder || fieldInfo.name || 'text field';
              const fieldKey = fieldInfo.name || fieldInfo.id || questionText;
              
              if (!filledFields.includes(fieldKey)) {
                console.log(`   🤖 Generating answer for required field: ${questionText}`);
                const answer = await this.generateAnswer(questionText, 'text');
                
                if (answer) {
                  await field.fill(answer);
                  await this.page.waitForTimeout(500);
                  filledFields.push(fieldKey);
                  console.log(`   ✅ Filled required field "${questionText}"`);
                }
              }
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        console.warn('   ⚠️  Error checking fields with asterisks:', error);
      }

      if (filledFields.length > 0) {
        console.log(`   ✅ Filled ${filledFields.length} text field(s) using AI`);
      } else {
        console.log('   ℹ️  No required text fields found or all were already filled');
      }
    } catch (error) {
      console.warn('   ⚠️  Error filling required text fields:', error);
    }
  }

  async readResume(): Promise<string | null> {
    try {
      const resumePath = path.resolve(this.resumePath);
      return await fs.readFile(resumePath, 'utf-8');
    } catch (error) {
      console.error('❌ Error reading resume file:', error);
      return null;
    }
  }

  async readCoverLetter(): Promise<string> {
    try {
      const coverLetterPath = path.resolve(this.coverLetterPath);
      return await fs.readFile(coverLetterPath, 'utf8');
    } catch (error) {
      console.warn('⚠️  Cover letter not found, proceeding without it');
      return '';
    }
  }


  async runWithStats(): Promise<{
    jobsFound: number;
    jobsApplied: number;
    jobsFailed: number;
    failedJobs: Array<{ jobTitle: string; url: string; timestamp: string; reason: string }>;
  }> {
    let jobsFound = 0;
    let jobsApplied = 0;
    const allFailedJobs: Array<{ jobTitle: string; url: string; timestamp: string; reason: string }> = [];
    
    try {
      console.log('🚀 Starting Greenhouse Auto-Apply Bot...\n');

      // Initialize browser (will restore session from .browser-context if available)
      await this.initializeBrowser();

      // Verify session using saved browser context
      const isAuthenticated = await this.verifySession();
      
      if (!isAuthenticated) {
        throw new Error(
          '❌ No valid session found. Please:\n' +
          '   1. Run the bot once and manually login in the browser\n' +
          '   2. The session will be saved to .browser-context\n' +
          '   3. Future runs will use the saved session automatically\n' +
          '\n   Or ensure .browser-context file exists with valid session data.'
        );
      }
      
      console.log('✅ Using saved browser context, authenticated successfully');

      // Search for jobs
      const jobs = await this.searchJobs();
      jobsFound = jobs.length;

      if (jobs.length === 0) {
        console.log('\n⚠️  No matching jobs found.');
        return {
          jobsFound: 0,
          jobsApplied: 0,
          jobsFailed: 0,
          failedJobs: [],
        };
      }

      // Display found jobs
      console.log('\n📋 Found Jobs:');
      jobs.forEach((job, index) => {
        console.log(`${index + 1}. ${job.title}`);
      });

      // Apply to each matching job
      console.log('\n🎯 Starting auto-apply process...\n');
      const maxJobs = parseInt(process.env.MAX_APPLICATIONS || '10', 10);
      const jobsToApply = jobs.slice(0, maxJobs);
      console.log(`📋 Processing ${jobsToApply.length} jobs (out of ${jobs.length} total found)...`);

      let successCount = 0;
      for (const job of jobsToApply) {
        const success = await this.applyToJob(job);
        if (success) {
          successCount++;
        }

        // Delay between applications
        if (jobsToApply.indexOf(job) < jobsToApply.length - 1) {
          const delay = parseInt(process.env.DELAY_MS || '20000', 10);
          console.log(`\n⏳ Waiting ${delay}ms before next application...`);
          await this.sleep(delay);
        }
      }

      jobsApplied = successCount;
      console.log(`\n✅ Processed ${successCount}/${jobsToApply.length} applications`);

      // Save failed jobs
      if (this.failedSubmissions.length > 0) {
        await this.saveFailedSubmissions();
      }
      
      if (this.failedApplications.length > 0) {
        await this.saveFailedApplications();
      }

      // Collect all failed jobs
      allFailedJobs.push(...this.failedSubmissions);
      allFailedJobs.push(...this.failedApplications);

    } catch (error) {
      console.error('Fatal error:', error);
      
      // Save failed jobs even on error
      if (this.failedSubmissions.length > 0) {
        await this.saveFailedSubmissions();
      }
      
      if (this.failedApplications.length > 0) {
        await this.saveFailedApplications();
      }

      allFailedJobs.push(...this.failedSubmissions);
      allFailedJobs.push(...this.failedApplications);
      
      throw error;
    } finally {
      await this.close();
    }

    return {
      jobsFound,
      jobsApplied,
      jobsFailed: allFailedJobs.length,
      failedJobs: allFailedJobs,
    };
  }

  async run(): Promise<void> {
    console.log('🚀 Starting Greenhouse Auto-Apply Bot...\n');

    try {
      // Initialize browser (will restore session from .browser-context if available)
      await this.initializeBrowser();

      // Verify session using saved browser context
      const isAuthenticated = await this.verifySession();
      
      if (!isAuthenticated) {
        console.error(
          '❌ No valid session found. Please:\n' +
          '   1. Run the bot once and manually login in the browser\n' +
          '   2. The session will be saved to .browser-context\n' +
          '   3. Future runs will use the saved session automatically\n' +
          '\n   Or ensure .browser-context file exists with valid session data.'
        );
        await this.close();
        return;
      }
      
      console.log('✅ Using saved browser context, authenticated successfully');

      // Search for jobs
      const jobs = await this.searchJobs();

      if (jobs.length === 0) {
        console.log(
          '\n⚠️  No matching jobs found. Adjust your filters and try again.'
        );
        console.log('   Keeping browser open for 30 seconds so you can check the page...');
        await this.sleep(30000);
        await this.close();
        return;
      }

      // Display found jobs
      console.log('\n📋 Found Jobs:');
      jobs.forEach((job, index) => {
        console.log(`${index + 1}. ${job.title}`);
      });

      // Apply to each matching job (always enabled)
      console.log('\n🎯 Starting auto-apply process...\n');
      const maxJobs = parseInt(process.env.MAX_APPLICATIONS || '10', 10);
      
      // Get all jobs (they should already be loaded from searchJobs)
      const jobsToApply = jobs.slice(0, maxJobs);
      console.log(`📋 Processing ${jobsToApply.length} jobs (out of ${jobs.length} total found)...`);

      let successCount = 0;
      for (const job of jobsToApply) {
        const success = await this.applyToJob(job);
        if (success) {
          successCount++;
        }

        // Longer delay between applications to ensure forms are submitted
        if (jobsToApply.indexOf(job) < jobsToApply.length - 1) {
          const delay = parseInt(process.env.DELAY_MS || '20000', 10);
          console.log(`\n⏳ Waiting ${delay}ms before next application...`);
          await this.sleep(delay);
        }
      }

      console.log(`\n✅ Processed ${successCount}/${jobsToApply.length} applications`);

      console.log(
        `\n✅ Completed! Successfully processed ${successCount} applications`
      );

      // Keep browser open for a bit so user can see results
      console.log('\n⏳ Keeping browser open for 10 seconds...');
      await this.sleep(10000);
      
      // Save any remaining failed submissions
      if (this.failedSubmissions.length > 0) {
        await this.saveFailedSubmissions();
        console.log(`\n📋 Total failed submissions: ${this.failedSubmissions.length}`);
      }
      
      // Save any failed applications
      if (this.failedApplications.length > 0) {
        await this.saveFailedApplications();
        console.log(`\n📋 Total failed applications (exceeded 30s): ${this.failedApplications.length}`);
      }
    } catch (error) {
      console.error('Fatal error:', error);
      
      // Save failed submissions even on error
      if (this.failedSubmissions.length > 0) {
        await this.saveFailedSubmissions();
      }
      
      // Save failed applications even on error
      if (this.failedApplications.length > 0) {
        await this.saveFailedApplications();
      }
    } finally {
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Only run the bot if this file is executed directly (not imported)
// Don't auto-run if we're running test.ts or restart.ts
const scriptPath = process.argv[1] || '';
const isTestScript = scriptPath.includes('test.ts') || scriptPath.includes('restart.ts');
const isMainModule = !isTestScript && (scriptPath.includes('index.ts') || scriptPath.includes('index') || scriptPath.endsWith('index'));

if (isMainModule) {
  const bot = new GreenhouseAutoApplyBot();
  bot.run().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}


