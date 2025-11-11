# Greenhouse Auto-Apply Bot

An automated job application bot for Greenhouse jobs using Playwright and TypeScript.

## Features

- 🌐 Browser automation with Playwright (no API keys needed!)
- 🔐 Manual login flow - you enter credentials/code in the browser
- 🔍 Automatic job search on my.greenhouse.io/jobs
- 🎯 Filters for software engineering, fully remote jobs from past 10 days
- 📝 Automatically fill out application forms
- ⚙️ Configurable application settings
- 🛡️ Rate limiting and delays between applications

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Your resume in PDF format
- Optional: Cover letter in text format

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npm run playwright:install
```

4. Copy the example environment file:
```bash
copy env.example .env
```

5. Edit `.env` file with your personal information:
   - `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `PHONE`, `LOCATION`
   - Or configure in `config.json`

6. Place your resume as `resume.pdf` in the project root (or update the path in `.env`)

7. Optionally, create a `cover-letter.txt` file with your cover letter

## Usage

### Build and Run

```bash
# Build TypeScript
npm run build

# Run the bot
npm start
```

### Development Mode

```bash
npm run dev
```

## How It Works

1. **Browser Launch**: The bot opens a Chromium browser window (visible, not headless)

2. **Login Flow**:
   - Navigates to `https://my.greenhouse.io/users/sign_in`
   - **You manually enter your email and password in the browser**
   - If a verification code is required, **you enter it in the browser**
   - The bot waits for you to complete authentication
   - Once redirected to `/jobs`, the bot continues automatically

3. **Job Search**:
   - Navigates to the jobs page
   - Searches for jobs matching:
     - Keywords: "software engineering" or "software engineer"
     - Location: "remote" or "fully remote"
     - Date: Posted/updated in the past 10 days

4. **Application**:
   - For each matching job, the bot can:
     - Open the job details page
     - Click the apply button
     - Fill in application forms (if `AUTO_APPLY` is enabled)

## Configuration

### Environment Variables (.env)

- `FIRST_NAME`, `LAST_NAME`, `EMAIL`, `PHONE`, `LOCATION`: Your personal information
- `JOB_KEYWORDS`: Comma-separated keywords to filter jobs (default: "software engineering,software engineer")
- `LOCATIONS`: Comma-separated location keywords (default: "remote,fully remote")
- `AUTO_APPLY`: Set to `true` to enable auto-application (default: `false`)
- `DELAY_MS`: Delay in milliseconds between applications (default: 5000)
- `MAX_APPLICATIONS`: Maximum number of applications per run (default: 10)
- `RESUME_PATH`: Path to your resume PDF (default: `./resume.pdf`)
- `COVER_LETTER_PATH`: Path to your cover letter text file (default: `./cover-letter.txt`)

### Config File (config.json)

You can also configure everything in `config.json`:

```json
{
  "personalInfo": {
    "firstName": "Your First Name",
    "lastName": "Your Last Name",
    "email": "your.email@example.com",
    "phone": "+1234567890",
    "location": "Your City, State"
  },
  "jobFilters": {
    "keywords": ["software engineering", "software engineer"],
    "departments": [],
    "locations": ["remote", "fully remote"]
  },
  "applicationSettings": {
    "autoApply": false,
    "delayBetweenApplications": 5000,
    "maxApplicationsPerRun": 10
  }
}
```

## Important Notes

⚠️ **Important Considerations**:

1. **Manual Login**: The bot opens a browser window where you'll need to manually log in. This is intentional to handle 2FA/verification codes securely.

2. **Job Filtering**: By default, the bot searches for:
   - Software engineering positions
   - Fully remote jobs
   - Posted in the past 10 days

3. **Application Submission**: The current implementation includes a placeholder for application submission. You may need to customize the form filling logic based on Greenhouse's actual form structure.

4. **Rate Limiting**: The bot includes delays between applications to avoid overwhelming servers. Adjust `DELAY_MS` as needed.

5. **Legal and Ethical**: 
   - Always review job requirements before applying
   - Ensure automated applications are allowed by Greenhouse's terms of service
   - Customize your cover letter and answers for each position when possible
   - Use responsibly and ethically

## Troubleshooting

### Browser doesn't open
- Make sure Playwright browsers are installed: `npm run playwright:install`
- Check that Chromium is available in your system

### Login fails
- Make sure you complete the login process in the browser window
- Check that you're entering the correct credentials
- The bot waits up to 5 minutes for authentication

### No jobs found
- Verify you're logged in successfully
- Check that jobs matching your filters exist
- Try adjusting your keyword/location filters

### Application errors
- Verify your personal information is correctly configured
- Check that the resume file exists at the specified path
- Review the console output for specific error messages

## License

MIT

## Disclaimer

This tool is for educational purposes. Always ensure you comply with:
- Greenhouse's terms of service
- Applicable laws and regulations regarding automated applications
- Company-specific application requirements

Use responsibly and customize your applications appropriately.
