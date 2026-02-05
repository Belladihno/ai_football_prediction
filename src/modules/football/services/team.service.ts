import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from '../entities/team.entity';
import { Fixture, FixtureStatus } from '../entities/fixture.entity';
import { FootballDataOrgService, FdOTeam } from './football-data-org.service';

// Result type: 'W' = Win, 'D' = Draw, 'L' = Loss
export type FormResult = 'W' | 'D' | 'L';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectRepository(Team)
    private teamRepository: Repository<Team>,
    @InjectRepository(Fixture)
    private fixtureRepository: Repository<Fixture>,
    private footballData: FootballDataOrgService,
  ) {}

  async findAll(options?: { leagueId?: string; limit?: number }): Promise<Team[]> {
    const query = this.teamRepository.createQueryBuilder('team')
      .leftJoinAndSelect('team.league', 'league');

    if (options?.leagueId) {
      query.andWhere('team.leagueId = :leagueId', { leagueId: options.leagueId });
    }

    query.orderBy('team.name', 'ASC');

    if (options?.limit) {
      query.take(options.limit);
    }

    return query.getMany();
  }

  async findOne(id: string): Promise<Team> {
    const team = await this.teamRepository.findOne({
      where: { id },
      relations: ['league'],
    });

    if (!team) {
      throw new NotFoundException(`Team with ID ${id} not found`);
    }

    return team;
  }

  async findByExternalId(externalId: number): Promise<Team | null> {
    return this.teamRepository.findOne({
      where: { externalId },
      relations: ['league'],
    });
  }

  async findOrCreateTeam(externalId: number, name: string): Promise<Team> {
    let team = await this.findByExternalId(externalId);
    
    if (!team) {
      this.logger.log(`Creating team: ${name} (${externalId})`);
      
      const newTeam = new Team();
      newTeam.externalId = externalId;
      newTeam.name = name;
      newTeam.shortName = name.substring(0, 3).toUpperCase();
      newTeam.tla = name.substring(0, 3).toUpperCase();
      newTeam.crestUrl = '';
      newTeam.address = '';
      newTeam.website = '';
      newTeam.founded = 0;
      newTeam.clubColors = '';
      newTeam.venue = '';
      newTeam.leagueId = null as any;
      
      team = await this.teamRepository.save(newTeam);
    }
    
    return team;
  }

  async syncTeams(leagueCode: string, leagueId: string): Promise<{ created: number; updated: number }> {
    this.logger.log(`Syncing teams for competition ${leagueCode}`);

    const apiTeams = await this.footballData.getTeams(leagueCode);
    let created = 0;
    let updated = 0;

    for (const apiTeam of apiTeams) {
      const existingTeam = await this.findByExternalId(apiTeam.id);

      if (existingTeam) {
        await this.updateFromApi(existingTeam, apiTeam, leagueId);
        updated++;
      } else {
        await this.createFromApi(apiTeam, leagueId);
        created++;
      }
    }

    this.logger.log(`Sync complete: ${created} created, ${updated} updated`);
    return { created, updated };
  }

  private async createFromApi(apiTeam: FdOTeam, leagueId: string): Promise<Team> {
    const team = this.teamRepository.create({
      externalId: apiTeam.id,
      name: apiTeam.name,
      shortName: apiTeam.shortName || apiTeam.name.substring(0, 3).toUpperCase(),
      tla: apiTeam.tla,
      crestUrl: apiTeam.crest || '',
      address: apiTeam.address || '',
      website: apiTeam.website || '',
      founded: apiTeam.founded || 0,
      clubColors: apiTeam.clubColors || '',
      venue: apiTeam.venue || '',
      leagueId,
    });

    return this.teamRepository.save(team);
  }

  private async updateFromApi(team: Team, apiTeam: FdOTeam, leagueId: string): Promise<Team> {
    team.name = apiTeam.name;
    team.shortName = apiTeam.shortName || apiTeam.name.substring(0, 3).toUpperCase();
    team.tla = apiTeam.tla;
    team.crestUrl = apiTeam.crest || '';
    team.address = apiTeam.address || '';
    team.venue = apiTeam.venue || '';
    team.leagueId = leagueId;

    return this.teamRepository.save(team);
  }

  /**
   * Get the last N game results for a team
   * @param teamId - The internal team ID
   * @param gamesCount - Number of recent games to get
   * @returns Array of results: 'W' = Win, 'D' = Draw, 'L' = Loss
   */
  async getForm(teamId: string, gamesCount: number = 5): Promise<FormResult[]> {
    // Get all finished fixtures for this team (home and away), ordered by kickoff descending
    const homeFixtures = await this.fixtureRepository
      .createQueryBuilder('fixture')
      .where('fixture.homeTeamId = :teamId', { teamId })
      .andWhere('fixture.status = :status', { status: FixtureStatus.FINISHED })
      .andWhere('fixture.homeGoals IS NOT NULL')
      .orderBy('fixture.kickoff', 'DESC')
      .limit(gamesCount)
      .getMany();

    const awayFixtures = await this.fixtureRepository
      .createQueryBuilder('fixture')
      .where('fixture.awayTeamId = :teamId', { teamId })
      .andWhere('fixture.status = :status', { status: FixtureStatus.FINISHED })
      .andWhere('fixture.awayGoals IS NOT NULL')
      .orderBy('fixture.kickoff', 'DESC')
      .limit(gamesCount)
      .getMany();

    // Combine and sort by date (most recent first)
    const allFixtures = [...homeFixtures, ...awayFixtures]
      .sort((a, b) => b.kickoff.getTime() - a.kickoff.getTime())
      .slice(0, gamesCount);

    // Convert to results (oldest first for form calculation)
    const results: FormResult[] = allFixtures
      .sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime())
      .map((fixture) => {
        const isHome = fixture.homeTeamId === teamId;
        const teamGoals = isHome ? fixture.homeGoals! : fixture.awayGoals!;
        const opponentGoals = isHome ? fixture.awayGoals! : fixture.homeGoals!;

        if (teamGoals > opponentGoals) return 'W';
        if (teamGoals < opponentGoals) return 'L';
        return 'D';
      });

    return results;
  }
}
