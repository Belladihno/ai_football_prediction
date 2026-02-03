import { Controller, Post, Logger } from '@nestjs/common';
import { SyncService } from '../services/sync.service';

@Controller('sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(private readonly syncService: SyncService) {}

  // Manually trigger data sync
  @Post()
  async triggerSync(): Promise<{ success: boolean; message: string; data: any }> {
    this.logger.log('Received sync request');

    try {
      const result = await this.syncService.triggerSync();
      return {
        success: true,
        message: 'Sync completed successfully',
        data: result,
      };
    } catch (error) {
      this.logger.error(`Sync failed: ${error.message}`);
      return {
        success: false,
        message: `Sync failed: ${error.message}`,
        data: null,
      };
    }
  }
}
