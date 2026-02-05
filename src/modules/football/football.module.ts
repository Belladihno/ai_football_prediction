import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

// Entities
import { League } from './entities/league.entity';
import { Team } from './entities/team.entity';
import { Fixture } from './entities/fixture.entity';
import { Standing } from './entities/standing.entity';
import { Injury } from './entities/injury.entity';

// Services
import { FootballDataOrgService } from './services/football-data-org.service';
import { FixtureService } from './services/fixture.service';
import { TeamService } from './services/team.service';
import { InjuryService } from './services/injury.service';
import { StandingsService } from './services/standings.service';

// Controllers
import { FixtureController } from './controllers/fixture.controller';
import { TeamController } from './controllers/team.controller';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([League, Team, Fixture, Standing, Injury]),
  ],
  controllers: [FixtureController, TeamController],
  providers: [
    FootballDataOrgService,
    FixtureService,
    TeamService,
    InjuryService,
    StandingsService,
  ],
  exports: [
    FootballDataOrgService,
    FixtureService,
    TeamService,
    InjuryService,
    StandingsService,
  ],
})
export class FootballModule { }

