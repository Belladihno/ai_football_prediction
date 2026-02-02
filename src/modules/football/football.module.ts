import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// Entities
import { League } from './entities/league.entity';
import { Team } from './entities/team.entity';
import { Fixture } from './entities/fixture.entity';

// Services
import { FootballDataApiService } from './services/football-data-api.service';
import { FixtureService } from './services/fixture.service';
import { TeamService } from './services/team.service';

// Controllers
import { FixtureController } from './controllers/fixture.controller';
import { TeamController } from './controllers/team.controller';

@Module({
  imports: [TypeOrmModule.forFeature([League, Team, Fixture])],
  controllers: [FixtureController, TeamController],
  providers: [FootballDataApiService, FixtureService, TeamService],
  exports: [FootballDataApiService, FixtureService, TeamService],
})
export class FootballModule {}
