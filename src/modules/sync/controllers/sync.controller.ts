import { Controller, Post, Delete, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SyncService } from '../services/sync.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fixture } from '../../football/entities/fixture.entity';
import { Team } from '../../football/entities/team.entity';
import { League } from '../../football/entities/league.entity';
import { Standing } from '../../football/entities/standing.entity';
import { Prediction } from '../../predictions/entities/prediction.entity';

@ApiTags('Sync')
@Controller('sync')
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    private readonly syncService: SyncService,
    @InjectRepository(Fixture) private fixtureRepository: Repository<Fixture>,
    @InjectRepository(Team) private teamRepository: Repository<Team>,
    @InjectRepository(League) private leagueRepository: Repository<League>,
    @InjectRepository(Standing) private standingRepository: Repository<Standing>,
    @InjectRepository(Prediction) private predictionRepository: Repository<Prediction>,
  ) {}

  // Manually trigger data sync
  @Post()
  @ApiOperation({ summary: 'Trigger data sync', description: 'Manually triggers synchronization of fixtures, teams, and standings from external APIs' })
  @ApiResponse({ status: 200, description: 'Sync result' })
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

  // Clear database (for fresh start)
  @Delete('clear')
  @ApiOperation({ summary: 'Clear database', description: 'Clears all synced data from the database for a fresh start' })
  @ApiResponse({ status: 200, description: 'Database cleared' })
  async clearDatabase(): Promise<{ success: boolean; message: string; data: any }> {
    this.logger.log('Received database clear request');

    try {
      // Delete in order due to foreign keys
      await this.predictionRepository.createQueryBuilder().delete().execute();
      await this.fixtureRepository.createQueryBuilder().delete().execute();
      await this.standingRepository.createQueryBuilder().delete().execute();
      await this.teamRepository.createQueryBuilder().delete().execute();
      await this.leagueRepository.createQueryBuilder().delete().execute();

      this.logger.log('Database cleared successfully');
      return {
        success: true,
        message: 'Database cleared successfully. Ready for fresh sync.',
        data: {
          predictions: 0,
          fixtures: 0,
          standings: 0,
          teams: 0,
          leagues: 0,
        },
      };
    } catch (error) {
      this.logger.error(`Database clear failed: ${error.message}`);
      return {
        success: false,
        message: `Database clear failed: ${error.message}`,
        data: null,
      };
    }
  }
}
