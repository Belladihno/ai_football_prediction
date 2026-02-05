import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fixture, FixtureStatus } from '../entities/fixture.entity';
import { FootballDataOrgService, FdOMatch } from './football-data-org.service';
import { TeamService } from './team.service';
import { League } from '../entities/league.entity';

@Injectable()
export class FixtureService {
  private readonly logger = new Logger(FixtureService.name);

  constructor(
    @InjectRepository(Fixture)
    private fixtureRepository: Repository<Fixture>,
    private footballData: FootballDataOrgService,
    private teamService: TeamService,
  ) {}

  async findAll(options?: {
    leagueId?: string;
    fromDate?: Date;
    toDate?: Date;
    status?: FixtureStatus;
    limit?: number;
  }): Promise<Fixture[]> {
    const query = this.fixtureRepository.createQueryBuilder('fixture')
      .leftJoinAndSelect('fixture.homeTeam', 'homeTeam')
      .leftJoinAndSelect('fixture.awayTeam', 'awayTeam')
      .leftJoinAndSelect('fixture.league', 'league');

    if (options?.leagueId) {
      query.andWhere('fixture.leagueId = :leagueId', { leagueId: options.leagueId });
    }

    if (options?.fromDate) {
      query.andWhere('fixture.kickoff >= :fromDate', { fromDate: options.fromDate });
    }

    if (options?.toDate) {
      query.andWhere('fixture.kickoff <= :toDate', { toDate: options.toDate });
    }

    if (options?.status) {
      query.andWhere('fixture.status = :status', { status: options.status });
    }

    query.orderBy('fixture.kickoff', 'ASC');

    if (options?.limit) {
      query.take(options.limit);
    }

    return query.getMany();
  }

  async findOne(id: string): Promise<Fixture> {
    const fixture = await this.fixtureRepository.findOne({
      where: { id },
      relations: ['homeTeam', 'awayTeam', 'league'],
    });

    if (!fixture) {
      throw new NotFoundException(`Fixture with ID ${id} not found`);
    }

    return fixture;
  }

  async findByExternalId(externalId: number): Promise<Fixture | null> {
    return this.fixtureRepository.findOne({
      where: { externalId },
      relations: ['homeTeam', 'awayTeam', 'league'],
    });
  }

  async getTodayFixtures(): Promise<Fixture[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return this.findAll({ fromDate: today, toDate: tomorrow });
  }

  async getUpcomingFixtures(days: number = 7): Promise<Fixture[]> {
    const now = new Date();
    const future = new Date();
    future.setDate(now.getDate() + days);

    const statuses: FixtureStatus[] = [FixtureStatus.SCHEDULED, FixtureStatus.TIMED];

    return this.fixtureRepository.createQueryBuilder('fixture')
      .leftJoinAndSelect('fixture.homeTeam', 'homeTeam')
      .leftJoinAndSelect('fixture.awayTeam', 'awayTeam')
      .leftJoinAndSelect('fixture.league', 'league')
      .where('fixture.kickoff >= :fromDate', { fromDate: now })
      .andWhere('fixture.kickoff <= :toDate', { toDate: future })
      .andWhere('fixture.status IN (:...statuses)', { statuses })
      .orderBy('fixture.kickoff', 'ASC')
      .getMany();
  }

  async syncFixtures(leagueCode: string, leagueId: string): Promise<{ created: number; updated: number }> {
    this.logger.log(`Syncing fixtures for league ${leagueCode}`);

    // Get all matches for the competition
    const apiMatches = await this.footballData.getMatches(leagueCode);
    
    // Filter for scheduled/timed matches (upcoming)
    const upcomingMatches = apiMatches.filter(m => 
      m.status === 'SCHEDULED' || m.status === 'TIMED'
    );

    let created = 0;
    let updated = 0;

    for (const apiMatch of upcomingMatches) {
      const existingFixture = await this.findByExternalId(apiMatch.id);

      if (existingFixture) {
        await this.updateFromApi(existingFixture, apiMatch, leagueId);
        updated++;
      } else {
        await this.createFromApi(apiMatch, leagueId);
        created++;
      }
    }

    this.logger.log(`Sync complete: ${created} created, ${updated} updated`);
    return { created, updated };
  }

  async syncAllFixtures(leagueCode: string, leagueId: string): Promise<{ created: number; updated: number }> {
    this.logger.log(`Syncing ALL fixtures for league ${leagueCode}`);

    // Get all matches for the competition
    const apiMatches = await this.footballData.getMatches(leagueCode);

    let created = 0;
    let updated = 0;

    for (const apiMatch of apiMatches) {
      const existingFixture = await this.findByExternalId(apiMatch.id);

      if (existingFixture) {
        await this.updateFromApi(existingFixture, apiMatch, leagueId);
        updated++;
      } else {
        await this.createFromApi(apiMatch, leagueId);
        created++;
      }
    }

    this.logger.log(`Sync complete: ${created} created, ${updated} updated`);
    return { created, updated };
  }

  private async createFromApi(apiMatch: FdOMatch, leagueId: string): Promise<Fixture> {
    // Find or create teams
    const homeTeam = await this.teamService.findOrCreateTeam(
      apiMatch.homeTeam.id,
      apiMatch.homeTeam.name,
    );
    const awayTeam = await this.teamService.findOrCreateTeam(
      apiMatch.awayTeam.id,
      apiMatch.awayTeam.name,
    );

    const fixture = this.fixtureRepository.create({
      externalId: apiMatch.id,
      kickoff: new Date(apiMatch.utcDate),
      matchday: apiMatch.matchday || null,
      status: this.mapStatus(apiMatch.status),
      homeGoals: apiMatch.score.fullTime.home,
      awayGoals: apiMatch.score.fullTime.away,
      homeHalfTimeGoals: apiMatch.score.halfTime.home,
      awayHalfTimeGoals: apiMatch.score.halfTime.away,
      venue: null, // football-data.org doesn't include venue in match response
      referee: null,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      leagueId,
    });

    return this.fixtureRepository.save(fixture);
  }

  private updateFromApi(fixture: Fixture, apiMatch: FdOMatch, leagueId: string): Promise<Fixture> {
    fixture.kickoff = new Date(apiMatch.utcDate);
    fixture.matchday = apiMatch.matchday || null;
    fixture.status = this.mapStatus(apiMatch.status);
    fixture.homeGoals = apiMatch.score.fullTime.home;
    fixture.awayGoals = apiMatch.score.fullTime.away;
    fixture.homeHalfTimeGoals = apiMatch.score.halfTime.home;
    fixture.awayHalfTimeGoals = apiMatch.score.halfTime.away;

    return this.fixtureRepository.save(fixture);
  }

  private mapStatus(status: string): FixtureStatus {
    const statusMap: Record<string, FixtureStatus> = {
      'SCHEDULED': FixtureStatus.SCHEDULED,
      'TIMED': FixtureStatus.TIMED,
      'IN_PLAY': FixtureStatus.IN_PLAY,
      'PAUSED': FixtureStatus.PAUSED,
      'FINISHED': FixtureStatus.FINISHED,
      'POSTPONED': FixtureStatus.POSTPONED,
      'SUSPENDED': FixtureStatus.SUSPENDED,
      'CANCELLED': FixtureStatus.CANCELLED,
    };

    return statusMap[status] || FixtureStatus.SCHEDULED;
  }
}
