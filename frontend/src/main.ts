interface BotStats {
  success: boolean;
  jobsFound: number;
  jobsApplied: number;
  jobsFailed: number;
  failedJobs: Array<{
    jobTitle: string;
    url: string;
    timestamp: string;
    reason: string;
  }>;
  error?: string;
}

interface FailedJob {
  jobTitle: string;
  url: string;
  timestamp: string;
  reason: string;
}

class App {
  private startBtn: HTMLButtonElement | null = null;
  private stopBtn: HTMLButtonElement | null = null;
  private loadingDiv: HTMLElement | null = null;
  private statsDiv: HTMLElement | null = null;
  private failedJobsDiv: HTMLElement | null = null;
  private errorDiv: HTMLElement | null = null;
  private abortController: AbortController | null = null;

  constructor() {
    this.init();
  }

  private init() {
    const app = document.getElementById('app');
    if (!app) return;

    app.innerHTML = `
      <div class="container">
        <header>
          <h1>🚀 Greenhouse Auto-Apply Bot</h1>
          <p>Automatically apply to Greenhouse job listings</p>
        </header>

        <main>
          <div class="controls">
            <button id="startBtn" class="btn btn-primary">Start Bot</button>
            <button id="stopBtn" class="btn btn-secondary" disabled>Stop</button>
          </div>

          <div id="loading" class="loading hidden">
            <div class="spinner"></div>
            <p>Bot is running... This may take several minutes.</p>
          </div>

          <div id="stats" class="stats hidden">
            <h2>Statistics</h2>
            <div class="stats-grid">
              <div class="stat-card">
                <div class="stat-value" id="jobsFound">0</div>
                <div class="stat-label">Jobs Found</div>
              </div>
              <div class="stat-card">
                <div class="stat-value" id="jobsApplied">0</div>
                <div class="stat-label">Jobs Applied</div>
              </div>
              <div class="stat-card">
                <div class="stat-value" id="jobsFailed">0</div>
                <div class="stat-label">Jobs Failed</div>
              </div>
            </div>
          </div>

          <div id="failedJobs" class="failed-jobs hidden">
            <h2>Failed Jobs</h2>
            <div id="failedJobsList" class="failed-jobs-list"></div>
          </div>

          <div id="error" class="error hidden"></div>
        </main>
      </div>
    `;

    this.startBtn = document.getElementById('startBtn') as HTMLButtonElement;
    this.stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    this.loadingDiv = document.getElementById('loading') as HTMLElement;
    this.statsDiv = document.getElementById('stats') as HTMLElement;
    this.failedJobsDiv = document.getElementById('failedJobs') as HTMLElement;
    this.errorDiv = document.getElementById('error') as HTMLElement;

    this.startBtn?.addEventListener('click', () => this.startBot());
    this.stopBtn?.addEventListener('click', () => this.stopBot());

    // Load failed jobs on init
    this.loadFailedJobs();
  }

  private async startBot() {
    if (!this.startBtn || !this.stopBtn || !this.loadingDiv) return;

    this.startBtn.disabled = true;
    this.stopBtn.disabled = false;
    this.loadingDiv.classList.remove('hidden');
    if (this.statsDiv) this.statsDiv.classList.add('hidden');
    if (this.failedJobsDiv) this.failedJobsDiv.classList.add('hidden');
    if (this.errorDiv) {
      this.errorDiv.classList.add('hidden');
      this.errorDiv.textContent = '';
    }

    this.abortController = new AbortController();

    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api/run-bot';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: BotStats = await response.json();

      if (data.success) {
        this.displayStats(data);
      } else {
        throw new Error(data.error || 'Unknown error occurred');
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        this.showError('Bot execution was cancelled.');
      } else {
        this.showError(`Error: ${error.message}`);
      }
    } finally {
      if (this.startBtn) this.startBtn.disabled = false;
      if (this.stopBtn) this.stopBtn.disabled = true;
      if (this.loadingDiv) this.loadingDiv.classList.add('hidden');
      this.abortController = null;
    }
  }

  private stopBot() {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private displayStats(stats: BotStats) {
    const jobsFoundEl = document.getElementById('jobsFound');
    const jobsAppliedEl = document.getElementById('jobsApplied');
    const jobsFailedEl = document.getElementById('jobsFailed');

    if (jobsFoundEl) jobsFoundEl.textContent = stats.jobsFound.toString();
    if (jobsAppliedEl) jobsAppliedEl.textContent = stats.jobsApplied.toString();
    if (jobsFailedEl) jobsFailedEl.textContent = stats.jobsFailed.toString();

    if (this.statsDiv) this.statsDiv.classList.remove('hidden');

    if (stats.failedJobs.length > 0) {
      this.displayFailedJobs(stats.failedJobs);
      if (this.failedJobsDiv) this.failedJobsDiv.classList.remove('hidden');
    } else {
      if (this.failedJobsDiv) this.failedJobsDiv.classList.add('hidden');
    }
  }

  private displayFailedJobs(failedJobs: FailedJob[]) {
    const listDiv = document.getElementById('failedJobsList');
    if (!listDiv) return;

    listDiv.innerHTML = '';

    failedJobs.forEach((job) => {
      const jobCard = document.createElement('div');
      jobCard.className = 'failed-job-card';

      const title = document.createElement('h3');
      title.textContent = job.jobTitle;

      const reason = document.createElement('p');
      reason.className = 'reason';
      reason.textContent = job.reason.substring(0, 200) + (job.reason.length > 200 ? '...' : '');

      const timestamp = document.createElement('p');
      timestamp.className = 'timestamp';
      timestamp.textContent = new Date(job.timestamp).toLocaleString();

      const link = document.createElement('a');
      link.href = job.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'btn btn-link';
      link.textContent = 'Apply Manually';

      jobCard.appendChild(title);
      jobCard.appendChild(reason);
      jobCard.appendChild(timestamp);
      jobCard.appendChild(link);

      listDiv.appendChild(jobCard);
    });
  }

  private async loadFailedJobs() {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || '/api/failed-jobs';
      const response = await fetch(apiUrl);
      const data = await response.json();

      if (data.success && data.failedJobs?.length > 0) {
        this.displayFailedJobs(data.failedJobs);
        if (this.failedJobsDiv) this.failedJobsDiv.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Failed to load failed jobs:', error);
    }
  }

  private showError(message: string) {
    if (this.errorDiv) {
      this.errorDiv.textContent = message;
      this.errorDiv.classList.remove('hidden');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});

