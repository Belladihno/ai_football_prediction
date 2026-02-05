import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue, Job } from 'bull';

export interface SyncJobOptions {
  priority?: number;
  delay?: number;
  attempts?: number;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('sync-queue')
    private readonly syncQueue: Queue,
  ) {}

  /**
   * Schedule a full data sync
   */
  async scheduleSync(options: SyncJobOptions = {}): Promise<Job> {
    this.logger.log('Scheduling sync job');
    
    const job = await this.syncQueue.add(
      'sync-all-data',
      {},
      {
        priority: options.priority || 0,
        delay: options.delay || 0,
        attempts: options.attempts || 3,
      },
    );
    
    this.logger.log(`Sync job scheduled with ID: ${job.id}`);
    return job;
  }

  /**
   * Schedule fixture sync for a specific league
   */
  async scheduleFixtureSync(leagueCode: string, options: SyncJobOptions = {}): Promise<Job> {
    this.logger.log(`Scheduling fixture sync for ${leagueCode}`);
    
    return this.syncQueue.add(
      'sync-fixtures',
      { leagueCode },
      {
        priority: options.priority || 1,
        delay: options.delay || 0,
        attempts: options.attempts || 2,
      },
    );
  }

  /**
   * Schedule standings sync for a specific league
   */
  async scheduleStandingSync(leagueCode: string, options: SyncJobOptions = {}): Promise<Job> {
    this.logger.log(`Scheduling standings sync for ${leagueCode}`);
    
    return this.syncQueue.add(
      'sync-standings',
      { leagueCode },
      {
        priority: options.priority || 1,
        delay: options.delay || 0,
        attempts: options.attempts || 2,
      },
    );
  }

  /**
   * Get job status by ID
   */
  async getJobStatus(jobId: number): Promise<Job | null> {
    return this.syncQueue.getJob(jobId);
  }

  /**
   * Get all pending jobs
   */
  async getPendingJobs(): Promise<Job[]> {
    return this.syncQueue.getWaiting();
  }

  /**
   * Get all active jobs
   */
  async getActiveJobs(): Promise<Job[]> {
    return this.syncQueue.getActive();
  }

  /**
   * Clean up old jobs
   */
  async cleanup(): Promise<void> {
    await this.syncQueue.clean(1000, 'completed');
    await this.syncQueue.clean(1000, 'failed');
    this.logger.log('Queue cleanup completed');
  }
}
