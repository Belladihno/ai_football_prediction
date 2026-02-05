import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { QueueService } from './services/queue.service';

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'sync-queue',
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    }),
    ConfigModule,
  ],
  providers: [QueueService],
  exports: [BullModule, QueueService],
})
export class QueueModule {}
