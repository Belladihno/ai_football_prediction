import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from '../entities/team.entity';
import { FootballDataApiService } from './football-data-api.service';

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    @InjectRepository(Team)
    private teamRepository: Repository<Team>,
    private footballApi: FootballDataApiService,
  ) {}

  // Get all teams
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

  // Get team by ID
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

  // Get team by external ID (from API)
  async findByExternalId(externalId: number): Promise<Team | null> {
    return this.teamRepository.findOne({
      where: { externalId },
      relations: ['league'],
    });
  }

  // Get team form (last N games)
  async getForm(teamId: string, gamesCount: number = 5): Promise<string> {
    const team = await this.findOne(teamId);
    const matches = await this.footballApi.getTeamMatches(team.externalId, { limit: 20 });

    // Filter finished matches and take last N
    const finishedMatches = matches
      .filter(m => m.status === 'FINISHED')
      .reverse()
      .slice(0, gamesCount);

    // Build form string (W/D/L)
    let form = '';
    for (const match of finishedMatches) {
      const isHome = match.homeTeam.id === team.externalId;
      const teamGoals = isHome ? match.score.fullTime.home! : match.score.fullTime.away!;
      const opponentGoals = isHome ? match.score.fullTime.away! : match.score.fullTime.home!;

      if (teamGoals > opponentGoals) {
        form += 'W';
      } else if (teamGoals === opponentGoals) {
        form += 'D';
      } else {
        form += 'L';
      }
    }

    return form;
  }

  // Sync teams from API for a competition
  async syncTeams(competitionCode: string, leagueId: string): Promise<{ created: number; updated: number }> {
    this.logger.log(`Syncing teams for competition ${competitionCode}`);

    const apiTeams = await this.footballApi.getTeams(competitionCode);
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

  // Create team from API data
  private async createFromApi(apiTeam: any, leagueId: string): Promise<Team> {
    const team = this.teamRepository.create({
      externalId: apiTeam.id,
      name: apiTeam.name,
      shortName: apiTeam.shortName,
      tla: apiTeam.tla,
      crestUrl: apiTeam.crestUrl,
      address: apiTeam.address,
      website: apiTeam.website,
      founded: apiTeam.founded,
      clubColors: apiTeam.clubColors,
      venue: apiTeam.venue,
      leagueId,
    });

    return this.teamRepository.save(team);
  }

  // Update team from API data
  private async updateFromApi(team: Team, apiTeam: any, leagueId: string): Promise<Team> {
    team.name = apiTeam.name;
    team.shortName = apiTeam.shortName;
    team.tla = apiTeam.tla;
    team.crestUrl = apiTeam.crestUrl;
    team.address = apiTeam.address;
    team.website = apiTeam.website;
    team.founded = apiTeam.founded;
    team.clubColors = apiTeam.clubColors;
    team.venue = apiTeam.venue;
    team.leagueId = leagueId;

    return this.teamRepository.save(team);
  }
}
