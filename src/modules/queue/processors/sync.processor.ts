import { Processor, Process, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { SyncService } from '../../sync/services/sync.service';

@Processor('sync-queue')
export class SyncProcessor {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(private readonly syncService: SyncService) {}

  @Process('sync-all-data')
  async handleSyncAllData(job: Job) {
    this.logger.log(`Starting sync job ${job.id}`);
    const startTime = Date.now();

    try {
      const result = await this.syncService.triggerSync();
      const duration = Date.now() - startTime;
      
      this.logger.log(`Sync job ${job.id} completed in ${duration}ms`);
      
      return {
        success: true,
        ...result,
        duration,
      };
    } catch (error) {
      this.logger.error(`Sync job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }

  @Process('sync-fixtures')
  async handleSyncFixtures(job: Job<{ leagueCode: string }>) {
    this.logger.log(`Syncing fixtures for ${job.data.leagueCode}`);
    
    // This would call a more granular sync method
    // For now, we just log it
    return { success: true, leagueCode: job.data.leagueCode };
  }

  @Process('sync-standings')
  async handleSyncStandings(job: Job<{ leagueCode: string }>) {
    this.logger.log(`Syncing standings for ${job.data.leagueCode}`);
    
    return { success: true, leagueCode: job.data.leagueCode };
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`Job ${job.id} completed with result: ${JSON.stringify(result)}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed with error: ${error.message}`);
  }
}
