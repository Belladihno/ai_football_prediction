import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { SyncService } from './services/sync.service';
import { SyncProcessor } from '../queue/processors/sync.processor';
import { SyncController } from './controllers/sync.controller';
import { League } from '../football/entities/league.entity';
import { Team } from '../football/entities/team.entity';
import { Fixture } from '../football/entities/fixture.entity';
import { Standing } from '../football/entities/standing.entity';
import { Prediction } from '../predictions/entities/prediction.entity';
import { FootballModule } from '../football/football.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([League, Team, Fixture, Standing, Prediction]),
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
    FootballModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, SyncProcessor],
  exports: [SyncService, BullModule],
})
export class SyncModule {}
