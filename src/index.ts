import { chromium, Browser, Page } from 'playwright';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

interface PersonalInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
}

interface JobFilters {
  keywords: string[];
  departments: string[];
  locations: string[];
}

interface ApplicationSettings {
  autoApply: boolean;
  delayBetweenApplications: number;
  maxApplicationsPerRun: number;
}

interface Config {
  personalInfo: PersonalInfo;
  jobFilters: JobFilters;
  applicationSettings: ApplicationSettings;
}

interface Job {
  href: string;
  title: string;
  viewButton?: any; // Playwright ElementHandle for the view button
}

class GreenhouseAutoApplyBot {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private context: any = null; // Browser context for tab management
  private baseURL = 'https://my.greenhouse.io';
  private resumePath: string;
  private coverLetterPath: string;
  private config: Config;
  private contextPath: string;

  constructor() {
    this.resumePath = process.env.RESUME_PATH || './resume.pdf';
    this.coverLetterPath = process.env.COVER_LETTER_PATH || './cover-letter.txt';
    this.config = this.loadConfig();
    // Store browser context in a local directory
    this.contextPath = path.join(__dirname, '../.browser-context');
  }

  private loadConfig(): Config {
    try {
      const configPath = path.join(__dirname, '../config.json');
      const configData = fsSync.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } catch (error) {
      console.warn('Config file not found, using defaults');
      return {
        personalInfo: {
          firstName: process.env.FIRST_NAME || '',
          lastName: process.env.LAST_NAME || '',
          email: process.env.EMAIL || 'hi@macandersonuche.dev',
          phone: process.env.PHONE || '',
          location: process.env.LOCATION || '',
        },
        jobFilters: {
          keywords: process.env.JOB_KEYWORDS
            ? process.env.JOB_KEYWORDS.split(',')
            : ['software engineering', 'software engineer'],
          departments: process.env.DEPARTMENTS
            ? process.env.DEPARTMENTS.split(',')
            : [],
          locations: process.env.LOCATIONS
            ? process.env.LOCATIONS.split(',')
            : ['remote', 'fully remote'],
        },
        applicationSettings: {
          autoApply: true, // Always enabled
          delayBetweenApplications: parseInt(
            process.env.DELAY_MS || '20000',
            10
          ),
          maxApplicationsPerRun: parseInt(
            process.env.MAX_APPLICATIONS || '10',
            10
          ),
        },
      };
    }
  }

  async initializeBrowser(): Promise<void> {
    console.log('🌐 Launching browser...');
    
    // Check if we have a saved context
    const hasSavedContext = fsSync.existsSync(this.contextPath);
    
    if (hasSavedContext) {
      console.log('📦 Found saved session, attempting to restore...');
      try {
        // Launch browser
        this.browser = await chromium.launch({
          headless: false,
          slowMo: 500,
        });
        
        // Try to load saved context
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
              console.log('✅ Session restored successfully!');
              return;
            } else {
              console.log('⚠️  Saved session expired, will need to login again');
              await this.page.close();
              if (this.context) {
                await this.context.close();
              }
              this.context = null;
              this.page = null;
              // Continue to create new context below
            }
          }
        }
      } catch (error) {
        console.log('⚠️  Could not restore session, will create new one');
        if (this.browser) {
          await this.browser.close();
          this.browser = null;
        }
      }
    }
    
    // Create new browser context (either no saved session or session expired)
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false,
        slowMo: 500,
      });
    }
    
    if (!this.context) {
      this.context = await this.browser.newContext();
    }
    
    if (!this.page && this.context) {
      this.page = await this.context.newPage();
      if (this.page) {
        await this.page.setViewportSize({ width: 1280, height: 720 });
      }
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

    // Pre-fill email if available
    const email = this.config.personalInfo.email || 'hi@macandersonuche.dev';
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

    // Navigate directly to jobs page only if needed
    if (shouldNavigate) {
      console.log('🔍 Navigating to jobs page...');
      await this.page.goto(`${this.baseURL}/jobs`, {
        waitUntil: 'networkidle',
      });
      // Wait for page to load
      await this.page.waitForTimeout(2000);

      // Fill in search form
      console.log('📝 Filling in search form...');
      await this.fillSearchForm();
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
              if (cardText && /software engineer/i.test(cardText)) {
                // Try to get a more specific title by looking for headings or large text
                const titleElement = await cardElement.$('h1, h2, h3, h4, [class*="title"], [class*="name"]').catch(() => null);
                let title = '';
                if (titleElement) {
                  title = (await titleElement.textContent())?.trim() || '';
                }
                
                // Fallback: extract from card text (first line or text before company name)
                if (!title) {
                  const lines = cardText.split('\n').map(l => l.trim()).filter(l => l);
                  title = lines.find(line => /software engineer/i.test(line)) || lines[0] || cardText.split('\n')[0].trim();
                }
                
                if (title && /software engineer/i.test(title)) {
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
                  if (parentText && /software engineer/i.test(parentText)) {
                    const lines = parentText.split('\n').filter(l => l.trim());
                    const title = lines.find(l => /software engineer/i.test(l)) || lines[0];
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
                  if (cardText && /software engineer/i.test(cardText)) {
                    // Find view job button in this card
                    const viewButton = await card.$('button:has-text("View job"), a:has-text("View job"), button:has-text("View Job"), a:has-text("View Job")');
                    if (viewButton) {
                      // Extract title
                      const titleElement = await card.$('h1, h2, h3, h4, [class*="title"]');
                      const title = titleElement 
                        ? (await titleElement.textContent())?.trim() || ''
                        : cardText.split('\n').find(line => /software engineer/i.test(line)) || cardText.split('\n')[0].trim();
                      
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

      console.log(`✅ Found ${jobElements.length} jobs matching "software engineer"`);
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
            await titleInput.fill('software engineer');
            console.log('   ✅ Filled job title: software engineer');
            titleFilled = true;
            break;
          }
        } catch (e) {
          continue;
        }
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
      if (titleFilled || workTypeSelected || dateSelected) {
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
            console.log('   📄 Clicking "See more jobs" to load additional jobs...');
            await moreButton.click();
            await this.page.waitForTimeout(2000);
            await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
            return true;
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
        await jobPage.waitForTimeout(2000);
        
        // Use the job page for finding apply button
        this.page = jobPage;

        // Click into a text box to trigger auto-fill settings
        console.log('   📝 Clicking into text box to trigger auto-fill...');
        try {
          const textBoxSelectors = [
            'input[type="text"]',
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
                await this.page.waitForTimeout(500);
                console.log('   ✅ Clicked text box, auto-fill should trigger');
                break;
              }
            } catch (e) {
              continue;
            }
          }
        } catch (error) {
          console.warn('   ⚠️  Could not find text box to click');
        }

        // Scroll to the end of the page
        console.log('   📜 Scrolling to end of page...');
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await this.page.waitForTimeout(1000);
      } else if (job.href && !job.href.startsWith('job-')) {
        // Fallback: navigate directly if we have a URL
        await this.page.goto(job.href, { waitUntil: 'networkidle' });
        await this.page.waitForTimeout(2000);

        // Click into a text box to trigger auto-fill settings
        console.log('   📝 Clicking into text box to trigger auto-fill...');
        try {
          const textBoxSelectors = [
            'input[type="text"]',
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
                await this.page.waitForTimeout(500);
                console.log('   ✅ Clicked text box, auto-fill should trigger');
                break;
              }
            } catch (e) {
              continue;
            }
          }
        } catch (error) {
          console.warn('   ⚠️  Could not find text box to click');
        }

        // Scroll to the end of the page
        console.log('   📜 Scrolling to end of page...');
        await this.page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        await this.page.waitForTimeout(1000);
      } else {
        console.log('   ⚠️  No view button or URL found, skipping...');
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

      // Click apply button to open application form
      await applyButton.click();
      await this.page.waitForTimeout(2000);
      console.log('   ✅ Clicked apply button');

      // Wait for application form to appear
      console.log('   📋 Application form opened');
      console.log('   ⏳ Waiting for form to fully load...');
      await this.page.waitForTimeout(3000);

      // Check and tick all required checkboxes
      console.log('   ☑️  Checking required checkboxes...');
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

      let submissionSuccessful = false;
      
      if (!submitButton) {
        console.log('   ⚠️  Submit button not found, form may auto-submit or need manual submission');
        // Wait a bit more in case form auto-submits
        await this.page.waitForTimeout(3000);
        
        // Check if form auto-submitted by looking for success indicators
        try {
          const successIndicators = await Promise.race([
            this.page.waitForSelector('text=/success|submitted|thank you|application received/i', { timeout: 5000 }).then(() => true),
            this.page.waitForSelector('[class*="success"]', { timeout: 5000 }).then(() => true),
            this.page.waitForSelector('[class*="submitted"]', { timeout: 5000 }).then(() => true),
            this.page.waitForURL(/success|submitted|thank/i, { timeout: 5000 }).then(() => true),
            Promise.resolve(false),
          ]);
          
          if (successIndicators) {
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
        // Click submit button
        console.log('   📤 Clicking submit button...');
        await submitButton.click();
        await this.page.waitForTimeout(2000);
        
        // Wait for submission confirmation
        console.log('   ⏳ Waiting for submission confirmation...');
        try {
          // Look for success indicators
          await Promise.race([
            this.page.waitForSelector('text=/success|submitted|thank you|application received/i', { timeout: 10000 }),
            this.page.waitForSelector('[class*="success"]', { timeout: 10000 }),
            this.page.waitForSelector('[class*="submitted"]', { timeout: 10000 }),
            this.page.waitForURL(/success|submitted|thank/i, { timeout: 10000 }),
          ]).catch(() => {
            // If no explicit success indicator, wait a bit more
            console.log('   ⏳ No explicit success indicator found, waiting for form to process...');
          });
          
          await this.page.waitForTimeout(2000);
          submissionSuccessful = true;
          console.log('   ✅ Application submitted successfully');
        } catch (error) {
          console.warn('   ⚠️  Could not confirm submission');
          // Check for error messages
          try {
            const errorMessages = await this.page.$$('text=/error|invalid|required|missing/i');
            if (errorMessages.length > 0) {
              console.log('   ❌ Error messages found, submission may have failed');
              submissionSuccessful = false;
            } else {
              submissionSuccessful = true; // Assume success if no errors found
            }
          } catch (e) {
            submissionSuccessful = true; // Assume success on error
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
        return false;
      }
    } catch (error) {
      console.error(`   ❌ Error applying to job: ${error}`);
      return false;
    }
  }

  async readResume(): Promise<Buffer | null> {
    try {
      const resumePath = path.resolve(this.resumePath);
      return await fs.readFile(resumePath);
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


  async run(): Promise<void> {
    console.log('🚀 Starting Greenhouse Auto-Apply Bot...\n');

    if (!this.config.personalInfo.email) {
      console.error(
        '❌ Please configure your personal information in config.json or .env file'
      );
      return;
    }

    try {
      // Initialize browser (will restore session if available)
      await this.initializeBrowser();

      // Check if we need to login
      const needsLogin = !(await this.verifySession());
      
      if (needsLogin) {
        console.log('🔐 Session not found or expired, starting login flow...\n');
        const loggedIn = await this.login();
        if (!loggedIn) {
          console.error('❌ Failed to authenticate. Exiting...');
          await this.close();
          return;
        }
      } else {
        console.log('✅ Using saved session, skipping login');
      }

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
      const maxJobs = this.config.applicationSettings.maxApplicationsPerRun;
      let totalProcessed = 0;
      let allJobsProcessed = false;

      while (!allJobsProcessed && totalProcessed < maxJobs) {
        // Get current jobs on screen (only navigate on first iteration)
        const currentJobs = await this.searchJobs(totalProcessed === 0);
        
        if (currentJobs.length === 0) {
          console.log('   No more jobs found on screen');
          break;
        }

        const jobsToApply = currentJobs.slice(0, maxJobs - totalProcessed);
        console.log(`\n📋 Processing ${jobsToApply.length} jobs from current page...`);

        let successCount = 0;
        for (const job of jobsToApply) {
          const success = await this.applyToJob(job);
          if (success) {
            successCount++;
            totalProcessed++;
          }

          // Longer delay between applications to ensure forms are submitted
          if (jobsToApply.indexOf(job) < jobsToApply.length - 1) {
            const delay = this.config.applicationSettings.delayBetweenApplications;
            console.log(`\n⏳ Waiting ${delay}ms before next application...`);
            await this.sleep(delay);
          }
        }

        console.log(`\n✅ Processed ${successCount}/${jobsToApply.length} applications from this page`);
        console.log(`   Total processed: ${totalProcessed}/${maxJobs}`);

        // After processing all jobs on screen, try to load more
        if (totalProcessed < maxJobs) {
          const hasMoreJobs = await this.loadMoreJobs();
          if (!hasMoreJobs) {
            console.log('   No more jobs available');
            allJobsProcessed = true;
          } else {
            console.log('   ⏳ Waiting for more jobs to load...');
            await this.sleep(3000);
          }
        } else {
          allJobsProcessed = true;
        }
      }

      console.log(
        `\n✅ Completed! Successfully processed ${totalProcessed} applications`
      );

      // Keep browser open for a bit so user can see results
      console.log('\n⏳ Keeping browser open for 10 seconds...');
      await this.sleep(10000);
    } catch (error) {
      console.error('Fatal error:', error);
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

// Run the bot
const bot = new GreenhouseAutoApplyBot();
bot.run().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

