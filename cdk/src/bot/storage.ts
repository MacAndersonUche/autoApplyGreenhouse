// Storage abstraction for failed jobs
// Supports both DynamoDB (production) and local file (development)

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface FailedJob {
  jobTitle: string;
  url: string;
  timestamp: string;
  reason: string;
  type: 'submission' | 'application';
}

interface LocalFileData {
  [key: string]: FailedJob[] | number | string;
  totalFailed: number;
  lastUpdated: string;
}

class FailedJobsStorage {
  private dynamoClient: DynamoDBDocumentClient | null = null;
  private tableName: string | null = null;

  constructor() {
    const tableName = process.env.FAILED_JOBS_TABLE_NAME;
    if (tableName) {
      this.tableName = tableName;
      const client = new DynamoDBClient({});
      this.dynamoClient = DynamoDBDocumentClient.from(client);
    }
  }

  async save(job: FailedJob): Promise<void> {
    if (this.dynamoClient && this.tableName) {
      // Save to DynamoDB
      const id = `${job.type}-${randomUUID()}`;
      const ttl = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days TTL

      await this.dynamoClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            id,
            type: job.type,
            timestamp: job.timestamp,
            jobTitle: job.jobTitle,
            url: job.url,
            reason: job.reason,
            ttl,
          },
        })
      );
    } else {
      // Fallback to local file storage
      await this.saveToLocalFile(job);
    }
  }

  async saveBatch(jobs: FailedJob[]): Promise<void> {
    if (jobs.length === 0) return;

    if (this.dynamoClient && this.tableName) {
      // Save all to DynamoDB in parallel
      await Promise.all(jobs.map(job => this.save(job)));
    } else {
      // Save to local file - read existing, merge, write back
      try {
        const type = jobs[0].type;
        const filePath = path.join(process.cwd(), `failed-${type}s.json`);
        let existing: LocalFileData = {
          totalFailed: 0,
          lastUpdated: '',
        };

        try {
          const content = await fs.readFile(filePath, 'utf8');
          const parsed = JSON.parse(content);
          existing = {
            ...parsed,
            totalFailed: parsed.totalFailed || 0,
            lastUpdated: parsed.lastUpdated || '',
          };
        } catch {
          // File doesn't exist, start fresh
        }

        const key = `${type}s` as 'submissions' | 'applications';
        if (!existing[key] || !Array.isArray(existing[key])) {
          existing[key] = [];
        }

        const jobsArray = existing[key] as FailedJob[];
        jobsArray.push(...jobs);
        existing.totalFailed = (existing.totalFailed || 0) + jobs.length;
        existing.lastUpdated = new Date().toISOString();

        await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf8');
      } catch (error) {
        console.warn(`⚠️  Could not save failed ${jobs[0].type}s batch to file:`, error);
      }
    }
  }

  private async saveToLocalFile(job: FailedJob): Promise<void> {
    try {
      const filePath = path.join(process.cwd(), `failed-${job.type}s.json`);
      let existing: LocalFileData = {
        totalFailed: 0,
        lastUpdated: '',
      };

      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content);
        existing = {
          ...parsed,
          totalFailed: parsed.totalFailed || 0,
          lastUpdated: parsed.lastUpdated || '',
        };
      } catch {
        // File doesn't exist, start fresh
      }

      const key = `${job.type}s` as 'submissions' | 'applications';
      if (!existing[key] || !Array.isArray(existing[key])) {
        existing[key] = [];
      }

      const jobsArray = existing[key] as FailedJob[];
      jobsArray.push(job);
      existing.totalFailed = (existing.totalFailed || 0) + 1;
      existing.lastUpdated = new Date().toISOString();

      await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf8');
    } catch (error) {
      console.warn(`⚠️  Could not save failed ${job.type} to file:`, error);
    }
  }

  async getAll(): Promise<FailedJob[]> {
    if (this.dynamoClient && this.tableName) {
      // Read from DynamoDB
      const result = await this.dynamoClient.send(
        new ScanCommand({
          TableName: this.tableName,
        })
      );

      return (result.Items || []).map(item => ({
        jobTitle: item.jobTitle,
        url: item.url,
        timestamp: item.timestamp,
        reason: item.reason,
        type: item.type as 'submission' | 'application',
      }));
    } else {
      // Read from local files
      return this.readFromLocalFiles();
    }
  }

  private async readFromLocalFiles(): Promise<FailedJob[]> {
    const jobs: FailedJob[] = [];

    try {
      const submissionsPath = path.join(process.cwd(), 'failed-submissions.json');
      const content = await fs.readFile(submissionsPath, 'utf8');
      const data = JSON.parse(content) as LocalFileData;
      if (data.submissions && Array.isArray(data.submissions)) {
        jobs.push(...data.submissions.map((j: any) => ({ ...j, type: 'submission' as const })));
      }
    } catch {
      // File doesn't exist
    }

    try {
      const applicationsPath = path.join(process.cwd(), 'failed-applications.json');
      const content = await fs.readFile(applicationsPath, 'utf8');
      const data = JSON.parse(content) as LocalFileData;
      if (data.applications && Array.isArray(data.applications)) {
        jobs.push(...data.applications.map((j: any) => ({ ...j, type: 'application' as const })));
      }
    } catch {
      // File doesn't exist
    }

    return jobs;
  }
}

export const storage = new FailedJobsStorage();
