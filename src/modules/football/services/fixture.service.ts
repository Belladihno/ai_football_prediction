import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Fixture, FixtureStatus } from '../entities/fixture.entity';
import { FootballDataApiService } from './football-data-api.service';
import { League } from '../entities/league.entity';
import { Team } from '../entities/team.entity';

@Injectable()
export class FixtureService {
  private readonly logger = new Logger(FixtureService.name);

  constructor(
    @InjectRepository(Fixture)
    private fixtureRepository: Repository<Fixture>,
    private footballApi: FootballDataApiService,
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

    return this.findAll({ fromDate: now, toDate: future, status: FixtureStatus.SCHEDULED });
  }

  async syncFixtures(leagueCode: string, leagueId: string): Promise<{ created: number; updated: number }> {
    this.logger.log(`Syncing fixtures for league ${leagueCode}`);

    const apiFixtures = await this.footballApi.getUpcomingMatches(leagueCode);
    let created = 0;
    let updated = 0;

    for (const apiFixture of apiFixtures) {
      const existingFixture = await this.findByExternalId(apiFixture.id);

      if (existingFixture) {
        // Update existing fixture
        await this.updateFromApi(existingFixture, apiFixture, leagueId);
        updated++;
      } else {
        // Create new fixture
        await this.createFromApi(apiFixture, leagueId);
        created++;
      }
    }

    this.logger.log(`Sync complete: ${created} created, ${updated} updated`);
    return { created, updated };
  }

  // Create fixture from API data
  private async createFromApi(apiFixture: any, leagueId: string): Promise<Fixture> {
    // Find or create teams
    const homeTeam = await this.findOrCreateTeam(apiFixture.homeTeam.id, apiFixture.homeTeam.name);
    const awayTeam = await this.findOrCreateTeam(apiFixture.awayTeam.id, apiFixture.awayTeam.name);

    const fixture = this.fixtureRepository.create({
      externalId: apiFixture.id,
      kickoff: new Date(apiFixture.utcDate),
      matchday: apiFixture.matchday,
      status: this.mapStatus(apiFixture.status),
      homeGoals: apiFixture.score.fullTime.home,
      awayGoals: apiFixture.score.fullTime.away,
      homeHalfTimeGoals: apiFixture.score.halfTime.home,
      awayHalfTimeGoals: apiFixture.score.halfTime.away,
      venue: apiFixture.venue,
      referee: apiFixture.referee,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      leagueId,
    });

    return this.fixtureRepository.save(fixture);
  }

  // Update fixture from API data
  private async updateFromApi(fixture: Fixture, apiFixture: any, leagueId: string): Promise<Fixture> {
    fixture.kickoff = new Date(apiFixture.utcDate);
    fixture.matchday = apiFixture.matchday;
    fixture.status = this.mapStatus(apiFixture.status);
    fixture.homeGoals = apiFixture.score.fullTime.home;
    fixture.awayGoals = apiFixture.score.fullTime.away;
    fixture.homeHalfTimeGoals = apiFixture.score.halfTime.home;
    fixture.awayHalfTimeGoals = apiFixture.score.halfTime.away;
    fixture.venue = apiFixture.venue;
    fixture.referee = apiFixture.referee;

    return this.fixtureRepository.save(fixture);
  }

  // Map API status to our status enum
  private mapStatus(apiStatus: string): FixtureStatus {
    const statusMap: Record<string, FixtureStatus> = {
      SCHEDULED: FixtureStatus.SCHEDULED,
      TIMED: FixtureStatus.TIMED,
      IN_PLAY: FixtureStatus.IN_PLAY,
      PAUSED: FixtureStatus.PAUSED,
      FINISHED: FixtureStatus.FINISHED,
      POSTPONED: FixtureStatus.POSTPONED,
      SUSPENDED: FixtureStatus.SUSPENDED,
      CANCELLED: FixtureStatus.CANCELLED,
    };

    return statusMap[apiStatus] || FixtureStatus.SCHEDULED;
  }

  // Find or create team by external ID
  private async findOrCreateTeam(externalId: number, name: string): Promise<Team> {
    // This will be implemented in TeamService
    // For now, return a placeholder
    this.logger.warn(`Team ${name} (${externalId}) needs to be created first`);
    return { id: externalId.toString() } as Team;
  }
}
