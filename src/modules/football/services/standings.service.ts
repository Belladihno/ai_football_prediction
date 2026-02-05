import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FootballDataOrgService, FdOStandingResponse } from './football-data-org.service';
import { Standing } from '../entities/standing.entity';
import { Team } from '../entities/team.entity';

@Injectable()
export class StandingsService {
  private readonly logger = new Logger(StandingsService.name);

  constructor(
    @InjectRepository(Standing)
    private standingRepository: Repository<Standing>,
    @InjectRepository(Team)
    private teamRepository: Repository<Team>,
    private footballData: FootballDataOrgService,
  ) {}

  async syncStandings(competitionCode: string, leagueId: string): Promise<{ created: number; updated: number }> {
    const response = await this.footballData.getStandingsResponse(competitionCode);
    if (!response?.standings?.length) {
      this.logger.warn(`No standings returned for ${competitionCode}`);
      return { created: 0, updated: 0 };
    }

    const standingBlock = response.standings.find(s => s.type === 'TOTAL') || response.standings[0];
    const table = standingBlock?.table || [];

    if (table.length === 0) {
      this.logger.warn(`Empty standings table for ${competitionCode}`);
      return { created: 0, updated: 0 };
    }

    const season = this.buildSeasonString(response);

    const teams = await this.teamRepository.find({ where: { leagueId } });
    const teamByExternalId = new Map<number, Team>();
    teams.forEach(t => teamByExternalId.set(t.externalId, t));

    const existing = await this.standingRepository.find({ where: { leagueId } });
    const existingByTeamId = new Map<string, Standing>();
    existing.forEach(s => existingByTeamId.set(s.teamId, s));

    const toSave: Standing[] = [];
    let created = 0;
    let updated = 0;

    for (const row of table) {
      const team = teamByExternalId.get(row.team.id);
      if (!team) {
        this.logger.warn(`Standing team not found in DB: ${row.team.name} (${row.team.id})`);
        continue;
      }

      const existingStanding = existingByTeamId.get(team.id);
      const standing = existingStanding ?? this.standingRepository.create({ teamId: team.id, leagueId });

      standing.position = row.position;
      standing.playedGames = row.playedGames;
      standing.gamesPlayed = row.playedGames;
      standing.won = row.won;
      standing.drawn = row.draw;
      standing.lost = row.lost;
      standing.goalsFor = row.goalsFor;
      standing.goalsAgainst = row.goalsAgainst;
      standing.goalDifference = row.goalDifference;
      standing.points = row.points;
      standing.form = row.form || '';
      standing.status = '';
      standing.season = season || '';

      if (existingStanding) updated++;
      else created++;

      toSave.push(standing);
    }

    if (toSave.length > 0) {
      await this.standingRepository.save(toSave);
    }

    this.logger.log(`Standings synced for ${competitionCode}: ${created} created, ${updated} updated`);
    return { created, updated };
  }

  private buildSeasonString(response: FdOStandingResponse): string | null {
    const start = response?.season?.startDate ? new Date(response.season.startDate) : null;
    const end = response?.season?.endDate ? new Date(response.season.endDate) : null;

    if (start && end) {
      return `${start.getUTCFullYear()}/${end.getUTCFullYear()}`;
    }

    if (start) {
      return `${start.getUTCFullYear()}/${start.getUTCFullYear() + 1}`;
    }

    return null;
  }
}
