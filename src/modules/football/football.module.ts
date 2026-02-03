import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities
import { League } from './entities/league.entity';
import { Team } from './entities/team.entity';
import { Fixture } from './entities/fixture.entity';
import { Standing } from './entities/standing.entity';

// Services
import { FootballDataApiService } from './services/football-data-api.service';
import { FixtureService } from './services/fixture.service';
import { TeamService } from './services/team.service';
import { HistoricalDataService } from './services/historical-data.service';

// Controllers
import { FixtureController } from './controllers/fixture.controller';
import { TeamController } from './controllers/team.controller';
import { TrainingDataController } from './controllers/training-data.controller';

@Module({
  imports: [TypeOrmModule.forFeature([League, Team, Fixture, Standing])],
  controllers: [FixtureController, TeamController, TrainingDataController],
  providers: [
    FootballDataApiService,
    FixtureService,
    TeamService,
    HistoricalDataService,
  ],
  exports: [
    FootballDataApiService,
    FixtureService,
    TeamService,
    HistoricalDataService,
  ],
})
export class FootballModule { }


