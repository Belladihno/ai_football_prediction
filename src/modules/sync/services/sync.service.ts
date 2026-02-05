import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { League } from '../../football/entities/league.entity';
import { TeamService } from '../../football/services/team.service';
import { FixtureService } from '../../football/services/fixture.service';
import { StandingsService } from '../../football/services/standings.service';
import { InjuryService } from '../../football/services/injury.service';
import { FootballDataOrgService, COMPETITION_CODES } from '../../football/services/football-data-org.service';

// League codes mapped to football-data.org competition codes
const LEAGUES = [
  { code: 'PL', name: 'Premier League', competitionCode: COMPETITION_CODES.PREMIER_LEAGUE },
  { code: 'PD', name: 'La Liga', competitionCode: COMPETITION_CODES.LA_LIGA },
  { code: 'BL1', name: 'Bundesliga', competitionCode: COMPETITION_CODES.BUNDESLIGA },
  { code: 'SA', name: 'Serie A', competitionCode: COMPETITION_CODES.SERIE_A },
  { code: 'FL1', name: 'Ligue 1', competitionCode: COMPETITION_CODES.LIGUE_1 },
];

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(League)
    private leagueRepository: Repository<League>,
    private teamService: TeamService,
    private fixtureService: FixtureService,
    private standingsService: StandingsService,
    private injuryService: InjuryService,
    private footballData: FootballDataOrgService,
  ) {}

  // Sync teams and fixtures every 6 hours
  @Cron(CronExpression.EVERY_6_HOURS)
  async syncAllData(): Promise<void> {
    this.logger.log('Starting scheduled data sync');

    try {
      await this.injuryService.syncPremierLeagueInjuries();

      for (const league of LEAGUES) {
        await this.syncLeague(league.code, league.name, league.competitionCode);
      }

      this.logger.log('Data sync completed successfully');
    } catch (error) {
      this.logger.error(`Data sync failed: ${error.message}`);
    }
  }

  // Sync a single league
  async syncLeague(code: string, name: string, competitionCode: string): Promise<void> {
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
    const teamResult = await this.teamService.syncTeams(competitionCode, league.id);
    this.logger.log(`${name} teams: ${teamResult.created} created, ${teamResult.updated} updated`);

    // Add delay to avoid rate limiting (10 requests/minute)
    await this.delay(6000);

    // Sync standings
    await this.standingsService.syncStandings(competitionCode, league.id);

    // Add delay to avoid rate limiting (10 requests/minute)
    await this.delay(6000);

    // Sync fixtures (all - upcoming and historical)
    const fixtureResult = await this.fixtureService.syncAllFixtures(competitionCode, league.id);
    this.logger.log(`${name} fixtures: ${fixtureResult.created} created, ${fixtureResult.updated} updated`);
  }

  /**
   * Helper delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Manually trigger sync
  async triggerSync(): Promise<{ leagues: number; teams: number; fixtures: number; historical: number }> {
    this.logger.log('Manual sync triggered');

    let totalTeamsCreated = 0;
    let totalTeamsUpdated = 0;
    let totalFixturesCreated = 0;
    let totalFixturesUpdated = 0;
    let leaguesCreated = 0;

    await this.injuryService.syncPremierLeagueInjuries();

    for (let i = 0; i < LEAGUES.length; i++) {
      const league = LEAGUES[i];
      
      // Ensure league exists first
      let dbLeague = await this.leagueRepository.findOne({ where: { code: league.code } });
      if (!dbLeague) {
        dbLeague = this.leagueRepository.create({
          code: league.code,
          name: league.name,
          country: this.getCountryForLeague(league.code),
        });
        dbLeague = await this.leagueRepository.save(dbLeague);
        this.logger.log(`Created league: ${league.name}`);
        leaguesCreated++;
      }
      
      // Now sync teams
      const teamResult = await this.teamService.syncTeams(league.competitionCode, dbLeague.id);
      totalTeamsCreated += teamResult.created;
      totalTeamsUpdated += teamResult.updated;
      
      // Add delay between teams and fixtures (10 requests/minute)
      await this.delay(6000);

      // Sync standings
      await this.standingsService.syncStandings(league.competitionCode, dbLeague.id);

      // Add delay between standings and fixtures (10 requests/minute)
      await this.delay(6000);
      
      // Sync all fixtures
      const fixtureResult = await this.fixtureService.syncAllFixtures(league.competitionCode, dbLeague.id);
      totalFixturesCreated += fixtureResult.created;
      totalFixturesUpdated += fixtureResult.updated;
      
      // Add delay between leagues (10 requests/minute)
      if (i < LEAGUES.length - 1) {
        this.logger.log('Waiting 6 seconds before next league...');
        await this.delay(6000);
      }
    }

    return {
      leagues: leaguesCreated,
      teams: totalTeamsCreated + totalTeamsUpdated,
      fixtures: totalFixturesCreated + totalFixturesUpdated,
      historical: 0, // Not applicable for football-data.org (no historical data on free tier)
    };
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
