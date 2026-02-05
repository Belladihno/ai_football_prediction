import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import axios, { AxiosInstance } from 'axios';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Injury } from '../entities/injury.entity';
import { Team } from '../entities/team.entity';

export interface InjuryData {
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  status: 'OUT' | 'DOUBTFUL' | 'RECOVERING';
  injuryType: string;
  expectedReturn: Date | null;
  impact: number; // 0-1 scale
}

interface FplTeam {
  id: number;
  name: string;
  short_name: string;
}

interface FplPlayer {
  id: number;
  web_name: string;
  team: number;
  status: string;
  element_type: number;
  ep_next?: number;
  chance_of_playing_next_round: number | null;
  chance_of_playing_this_round: number | null;
  news: string;
}

interface FplBootstrapResponse {
  elements: FplPlayer[];
  teams: FplTeam[];
}

@Injectable()
export class InjuryService {
  private readonly logger = new Logger(InjuryService.name);
  private client: AxiosInstance;

  constructor(
    @InjectRepository(Injury)
    private injuryRepository: Repository<Injury>,
    @InjectRepository(Team)
    private teamRepository: Repository<Team>,
  ) {
    // Fantasy Premier League doesn't require API key for public data
    this.client = axios.create({
      baseURL: 'https://fantasy.premierleague.com/api',
      timeout: 5000,
    });
  }

  /**
   * Fetch raw FPL data
   */
  private async fetchFplBootstrap(): Promise<FplBootstrapResponse | null> {
    try {
      const response = await this.client.get('/bootstrap-static/');
      return response.data as FplBootstrapResponse;
    } catch (error) {
      this.logger.error(`Failed to fetch FPL data: ${error.message}`);
      return null;
    }
  }

  /**
   * Sync Premier League injuries from FPL to DB
   */
  async syncPremierLeagueInjuries(): Promise<{ total: number; mapped: number; skipped: number }> {
    const data = await this.fetchFplBootstrap();
    if (!data) return { total: 0, mapped: 0, skipped: 0 };

    const players = data.elements || [];
    const fplTeams = data.teams || [];

    const leagueTeams = await this.getPremierLeagueTeams();
    if (leagueTeams.length === 0) {
      this.logger.warn('No Premier League teams found in DB - injury sync skipped');
      return { total: 0, mapped: 0, skipped: 0 };
    }

    const teamIndex = this.buildTeamIndex(leagueTeams);
    const fplTeamToInternal = this.mapFplTeams(fplTeams, teamIndex);

    const injuredPlayers = players.filter(p => p.status !== 'a');
    const injuries: Injury[] = [];

    let mapped = 0;
    let skipped = 0;

    for (const player of injuredPlayers) {
      const team = fplTeamToInternal.get(player.team);
      if (!team) {
        skipped++;
        continue;
      }

      const impact01 = this.calculateImpact(player);
      const injury = this.injuryRepository.create({
        source: 'FPL',
        leagueCode: 'PL',
        teamId: team.id,
        teamExternalId: team.externalId,
        teamName: team.name,
        playerId: player.id,
        playerName: player.web_name,
        position: this.mapFplPosition(player.element_type),
        status: this.mapFplStatus(player.status),
        injuryType: player.news || 'Unknown',
        expectedReturn: player.chance_of_playing_next_round && player.chance_of_playing_next_round > 0
          ? this.estimateReturnDate(player.chance_of_playing_next_round)
          : null,
        impactScore: Number((impact01 * 10).toFixed(2)),
        lastUpdated: new Date(),
      });

      injuries.push(injury);
      mapped++;
    }

    await this.injuryRepository.delete({ source: 'FPL', leagueCode: 'PL' });
    if (injuries.length > 0) {
      await this.injuryRepository.save(injuries);
    }

    this.logger.log(`Synced PL injuries: total=${injuredPlayers.length}, mapped=${mapped}, skipped=${skipped}`);
    return { total: injuredPlayers.length, mapped, skipped };
  }

  // Sync PL injuries at 7 AM / 7 PM (server local time)
  @Cron('0 7,19 * * *')
  async scheduledInjurySync(): Promise<void> {
    try {
      await this.syncPremierLeagueInjuries();
    } catch (error) {
      this.logger.error(`Scheduled injury sync failed: ${error.message}`);
    }
  }

  /**
   * Get injury data for Premier League (raw, no DB)
   */
  async getPremierLeagueInjuries(): Promise<InjuryData[]> {
    const data = await this.fetchFplBootstrap();
    if (!data) return [];

    const players = data.elements || [];
    const teams = data.teams || [];
    const teamById = new Map(teams.map(t => [t.id, t]));

    const injuries: InjuryData[] = [];
    for (const player of players) {
      if (player.status !== 'a') {
        const team = teamById.get(player.team);
        injuries.push({
          playerId: player.id,
          playerName: player.web_name,
          teamId: player.team,
          teamName: team?.name || '',
          status: this.mapFplStatus(player.status),
          injuryType: player.news || 'Unknown',
          expectedReturn: player.chance_of_playing_next_round && player.chance_of_playing_next_round > 0
            ? this.estimateReturnDate(player.chance_of_playing_next_round)
            : null,
          impact: this.calculateImpact(player),
        });
      }
    }
    return injuries;
  }

  /**
   * Get injuries for a specific team
   */
  async getTeamInjuries(teamId: string): Promise<InjuryData[]> {
    const injuries = await this.injuryRepository.find({
      where: { teamId },
      order: { lastUpdated: 'DESC' },
    });

    return injuries.map(i => ({
      playerId: i.playerId || 0,
      playerName: i.playerName,
      teamId: i.teamExternalId || 0,
      teamName: i.teamName || '',
      status: i.status,
      injuryType: i.injuryType || 'Unknown',
      expectedReturn: i.expectedReturn,
      impact: Math.min(Number(i.impactScore) / 10, 1),
    }));
  }

  /**
   * Calculate injury impact on team performance (0-1 scale)
   */
  private calculateImpact(player: any): number {
    let impact = 0;

    // Key players have higher impact
    if (player.element_type === 1) { // Goalkeeper
      impact += 0.3;
    } else if (player.element_type === 2) { // Defender
      impact += 0.2;
    } else if (player.element_type === 3) { // Midfielder
      impact += 0.25;
    } else if (player.element_type === 4) { // Forward
      impact += 0.3;
    }

    // Players with high expected points have higher impact
    if (player.ep_next > 5) {
      impact += 0.2;
    }

    // Chance of playing affects impact
    if (player.chance_of_playing_this_round === null) {
      impact *= 0.7; // Doubtful
    } else if (player.chance_of_playing_this_round < 50) {
      impact *= 0.5;
    }

    return Math.min(impact, 1);
  }

  /**
   * Map FPL status code to our status
   */
  private mapFplStatus(status: string): 'OUT' | 'DOUBTFUL' | 'RECOVERING' {
    switch (status) {
      case 'i': return 'OUT';
      case 'u': return 'DOUBTFUL';
      case 'n': return 'RECOVERING';
      default: return 'DOUBTFUL';
    }
  }

  /**
   * Estimate return date based on chance percentage
   */
  private estimateReturnDate(chance: number | null): Date {
    const days = chance && chance > 50 ? 7 : 14;
    const returnDate = new Date();
    returnDate.setDate(returnDate.getDate() + days);
    return returnDate;
  }

  /**
   * Get total injury count for a team
   */
  getTeamInjuryCount(injuries: InjuryData[]): number {
    return injuries.filter(i => i.status === 'OUT').length;
  }

  /**
   * Get total injury impact for a team
   */
  getTeamInjuryImpact(injuries: InjuryData[]): number {
    if (injuries.length === 0) return 0;

    const totalImpact = injuries.reduce((sum, injury) => sum + injury.impact, 0);
    return Math.min(totalImpact / 5, 1); // Cap at 5 injuries worth of impact
  }

  /**
   * Get injury summary for a match
   */
  async getMatchInjurySummary(homeTeamId: string, awayTeamId: string): Promise<{
    homeTeam: { count: number; impact: number; players: string[] };
    awayTeam: { count: number; impact: number; players: string[] };
  }> {
    const [homeInjuries, awayInjuries] = await Promise.all([
      this.getTeamInjuries(homeTeamId),
      this.getTeamInjuries(awayTeamId),
    ]);

    return {
      homeTeam: {
        count: this.getTeamInjuryCount(homeInjuries),
        impact: this.getTeamInjuryImpact(homeInjuries),
        players: homeInjuries.map(i => i.playerName),
      },
      awayTeam: {
        count: this.getTeamInjuryCount(awayInjuries),
        impact: this.getTeamInjuryImpact(awayInjuries),
        players: awayInjuries.map(i => i.playerName),
      },
    };
  }

  /**
   * Scrape injury data from multiple sources
   */
  async scrapeAllInjuries(): Promise<InjuryData[]> {
    const injuries = await this.getPremierLeagueInjuries();
    this.logger.log(`Scraped ${injuries.length} total injuries (PL)`);
    return injuries;
  }

  /**
   * Get aggregated injury summary for a team (DB-backed)
   */
  async getTeamInjurySummary(teamId: string, sinceDays: number = 14): Promise<{ count: number; impact: number }> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
    const injuries = await this.injuryRepository.find({
      where: { teamId, lastUpdated: MoreThanOrEqual(since) },
    });

    if (injuries.length === 0) {
      return { count: 0, impact: 0 };
    }

    const count = injuries.length;
    const totalImpact = injuries.reduce((sum, i) => sum + Number(i.impactScore || 0), 0);
    const impact = Math.min(totalImpact / 10, 1);

    return { count, impact };
  }

  private async getPremierLeagueTeams(): Promise<Team[]> {
    return this.teamRepository
      .createQueryBuilder('team')
      .leftJoinAndSelect('team.league', 'league')
      .where('league.code = :code', { code: 'PL' })
      .getMany();
  }

  private buildTeamIndex(teams: Team[]): Map<string, Team> {
    const index = new Map<string, Team>();
    for (const team of teams) {
      const keys = new Set<string>();
      if (team.name) keys.add(this.normalizeName(team.name));
      if (team.shortName) keys.add(this.normalizeName(team.shortName));
      if (team.tla) keys.add(this.normalizeName(team.tla));
      keys.forEach(k => {
        if (k && !index.has(k)) index.set(k, team);
      });
    }
    return index;
  }

  private mapFplTeams(fplTeams: FplTeam[], index: Map<string, Team>): Map<number, Team> {
    const map = new Map<number, Team>();

    for (const fplTeam of fplTeams) {
      const normalized = this.normalizeName(fplTeam.name);
      const normalizedShort = this.normalizeName(fplTeam.short_name);

      const alias = this.fplAlias(normalized) || this.fplAlias(normalizedShort);
      const direct = index.get(normalized) || index.get(normalizedShort) || (alias ? index.get(alias) : undefined);

      if (direct) {
        map.set(fplTeam.id, direct);
        continue;
      }

      const fuzzy = this.findBestTeamMatch(normalized, index);
      if (fuzzy) {
        map.set(fplTeam.id, fuzzy);
      } else {
        this.logger.warn(`FPL team not mapped: ${fplTeam.name} (${fplTeam.id})`);
      }
    }

    return map;
  }

  private findBestTeamMatch(normalized: string, index: Map<string, Team>): Team | null {
    let best: { team: Team; score: number } | null = null;

    for (const [key, team] of index.entries()) {
      if (key.includes(normalized) || normalized.includes(key)) {
        const score = Math.min(key.length, normalized.length);
        if (!best || score > best.score) {
          best = { team, score };
        }
      }
    }

    return best?.team || null;
  }

  private normalizeName(name: string): string {
    return (name || '')
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(fc|afc|the|club)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private fplAlias(normalized: string): string | null {
    const aliases: Record<string, string> = {
      'man city': 'manchester city',
      'man utd': 'manchester united',
      'spurs': 'tottenham hotspur',
      'wolves': 'wolverhampton wanderers',
      'west ham': 'west ham united',
      'brighton': 'brighton hove albion',
      'newcastle': 'newcastle united',
      "nottm forest": 'nottingham forest',
      "nott m forest": 'nottingham forest',
      "nott'm forest": 'nottingham forest',
      'sheffield utd': 'sheffield united',
      'leeds': 'leeds united',
      'leicester': 'leicester city',
      'norwich': 'norwich city',
      'bournemouth': 'afc bournemouth',
      'west brom': 'west bromwich albion',
      'qpr': 'queens park rangers',
    };

    return aliases[normalized] || null;
  }

  private mapFplPosition(elementType: number): 'GK' | 'DEF' | 'MID' | 'FWD' {
    if (elementType === 1) return 'GK';
    if (elementType === 2) return 'DEF';
    if (elementType === 3) return 'MID';
    return 'FWD';
  }
}
