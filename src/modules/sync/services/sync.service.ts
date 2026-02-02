import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { League } from '../../football/entities/league.entity';
import { TeamService } from '../../football/services/team.service';
import { FixtureService } from '../../football/services/fixture.service';
import { FootballDataApiService } from '../../football/services/football-data-api.service';

// League codes for top 5 European leagues
const LEAGUE_CODES = {
  PL: 'Premier League',
  PD: 'La Liga',
  BL1: 'Bundesliga',
  SA: 'Serie A',
  FL1: 'Ligue 1',
};

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(League)
    private leagueRepository: Repository<League>,
    private teamService: TeamService,
    private fixtureService: FixtureService,
    private footballApi: FootballDataApiService,
  ) {}

  // Sync teams and fixtures every 6 hours
  @Cron(CronExpression.EVERY_6_HOURS)
  async syncAllData(): Promise<void> {
    this.logger.log('Starting scheduled data sync');

    try {
      for (const [code, name] of Object.entries(LEAGUE_CODES)) {
        await this.syncLeague(code, name);
      }

      this.logger.log('Data sync completed successfully');
    } catch (error) {
      this.logger.error(`Data sync failed: ${error.message}`);
    }
  }

  // Sync a single league
  async syncLeague(code: string, name: string): Promise<void> {
    this.logger.log(`Syncing ${name} (${code})`);

    // Find or create league
    let league = await this.leagueRepository.findOne({ where: { code } });
    if (!league) {
      league = this.leagueRepository.create({
        code,
        name,
        country: this.getCountryForLeague(code),
      });
      league = await this.leagueRepository.save(league);
      this.logger.log(`Created league: ${name}`);
    }

    // Sync teams
    const teamResult = await this.teamService.syncTeams(code, league.id);
    this.logger.log(`${name} teams: ${teamResult.created} created, ${teamResult.updated} updated`);

    // Sync fixtures
    const fixtureResult = await this.fixtureService.syncFixtures(code, league.id);
    this.logger.log(`${name} fixtures: ${fixtureResult.created} created, ${fixtureResult.updated} updated`);
  }

  // Manually trigger sync
  async triggerSync(): Promise<{ leagues: number; teams: number; fixtures: number }> {
    this.logger.log('Manual sync triggered');

    let totalTeamsCreated = 0;
    let totalTeamsUpdated = 0;
    let totalFixturesCreated = 0;
    let totalFixturesUpdated = 0;

    for (const [code, name] of Object.entries(LEAGUE_CODES)) {
      const teamResult = await this.syncTeamsOnly(code);
      const fixtureResult = await this.syncFixturesOnly(code);

      totalTeamsCreated += teamResult.created;
      totalTeamsUpdated += teamResult.updated;
      totalFixturesCreated += fixtureResult.created;
      totalFixturesUpdated += fixtureResult.updated;
    }

    return {
      leagues: Object.keys(LEAGUE_CODES).length,
      teams: totalTeamsCreated + totalTeamsUpdated,
      fixtures: totalFixturesCreated + totalFixturesUpdated,
    };
  }

  // Sync teams only
  private async syncTeamsOnly(competitionCode: string): Promise<{ created: number; updated: number }> {
    const league = await this.leagueRepository.findOne({ where: { code: competitionCode } });
    if (!league) {
      this.logger.warn(`League ${competitionCode} not found, skipping team sync`);
      return { created: 0, updated: 0 };
    }
    return this.teamService.syncTeams(competitionCode, league.id);
  }

  // Sync fixtures only
  private async syncFixturesOnly(competitionCode: string): Promise<{ created: number; updated: number }> {
    const league = await this.leagueRepository.findOne({ where: { code: competitionCode } });
    if (!league) {
      this.logger.warn(`League ${competitionCode} not found, skipping fixture sync`);
      return { created: 0, updated: 0 };
    }
    return this.fixtureService.syncFixtures(competitionCode, league.id);
  }

  // Get country for league code
  private getCountryForLeague(code: string): string {
    const countries: Record<string, string> = {
      PL: 'England',
      PD: 'Spain',
      BL1: 'Germany',
      SA: 'Italy',
      FL1: 'France',
    };
    return countries[code] || 'Unknown';
  }
}
