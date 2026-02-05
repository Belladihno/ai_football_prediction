import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosError } from 'axios';

// Competition codes for football-data.org
export const COMPETITION_CODES = {
  PREMIER_LEAGUE: 'PL',
  LA_LIGA: 'PD',
  BUNDESLIGA: 'BL1',
  SERIE_A: 'SA',
  LIGUE_1: 'FL1',
  CHAMPIONSHIP: 'ELC',
  EREDIVISIE: 'DED',
  PRIMEIRA_LIGA: 'PPL',
  SERIE_A_BRAZIL: 'BSA',
  CHAMPIONS_LEAGUE: 'CL',
  EUROPA_LEAGUE: 'EC',
};

// Types for football-data.org responses
export interface FdOMatch {
  area: {
    id: number;
    name: string;
    code: string;
  };
  competition: {
    id: number;
    name: string;
    code: string;
    emblem: string;
  };
  season: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number;
  };
  id: number;
  utcDate: string;
  status: 'SCHEDULED' | 'TIMED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'POSTPONED' | 'SUSPENDED' | 'CANCELLED';
  matchday: number;
  stage: string;
  group: string | null;
  lastUpdated: string;
  homeTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  awayTeam: {
    id: number;
    name: string;
    shortName: string;
    tla: string;
    crest: string;
  };
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT';
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
    regularTime: { home: number | null; away: number | null };
    extraTime: { home: number | null; away: number | null };
    penalties: { home: number | null; away: number | null };
  };
}

export interface FdOMatchListResponse {
  filters: {
    season: string;
    limit: number;
    permission: string;
  };
  resultSet: {
    count: number;
    first: string;
    last: string;
    played: number;
  };
  competition: {
    id: number;
    name: string;
    code: string;
  };
  matches: FdOMatch[];
}

export interface FdOTeam {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crest: string;
  address: string;
  website: string;
  founded: number;
  clubColors: string;
  venue: string;
  area: {
    id: number;
    name: string;
    code: string;
  };
}

export interface FdOTeamListResponse {
  count: number;
  filters: {
    season: string;
  };
  competition: {
    id: number;
    name: string;
    code: string;
  };
  season: {
    id: number;
    startDate: string;
    endDate: string;
  };
  teams: FdOTeam[];
}

export interface FdOStanding {
  stage: string;
  type: string;
  group: string | null;
  table: {
    position: number;
    team: {
      id: number;
      name: string;
      shortName: string;
      tla: string;
      crest: string;
    };
    playedGames: number;
    form: string;
    won: number;
    draw: number;
    lost: number;
    points: number;
    goalsFor: number;
    goalsAgainst: number;
    goalDifference: number;
  }[];
}

export interface FdOStandingResponse {
  filters: {
    season: string;
  };
  area: {
    id: number;
    name: string;
    code: string;
  };
  competition: {
    id: number;
    name: string;
    code: string;
  };
  season: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number;
  };
  standings: FdOStanding[];
}

@Injectable()
export class FootballDataOrgService {
  private readonly logger = new Logger(FootballDataOrgService.name);
  private client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('footballDataOrg.baseUrl') || 'https://api.football-data.org/v4';
    this.apiKey = this.configService.get<string>('footballDataOrg.apiKey') || '';

    this.logger.log(
      `Football-Data.org config: baseUrl=${this.baseUrl}, apiKey=${this.apiKey ? '***' : 'MISSING'}, apiKeyLen=${this.apiKey.length}`,
    );

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'X-Auth-Token': this.apiKey,
      },
    });
  }

  /**
   * Make API request with retry logic
   */
  private async makeRequest<T>(
    method: 'get' | 'post',
    url: string,
    params?: Record<string, any>,
    retries: number = 3,
  ): Promise<T | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.client.request({
          method,
          url,
          params,
        });
        return response.data;
      } catch (error) {
        const axiosError = error as AxiosError;
        if (attempt === retries) {
          this.logger.error(`Failed to fetch ${url} after ${retries} attempts: ${axiosError.message}`);
          this.logger.error(`Football-data.org response data: ${JSON.stringify(axiosError.response?.data)}`);
          return null;
        }
        // Wait before retry (exponential backoff)
        const waitTime = Math.pow(2, attempt) * 1000;
        this.logger.warn(`Retrying ${url} in ${waitTime}ms (attempt ${attempt}/${retries})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    return null;
  }

  /**
   * Get matches for a competition
   */
  async getMatches(
    competitionCode: string,
    statusOrOptions?:
      | string
      | {
          status?: string;
          season?: string | number;
          matchday?: number;
          dateFrom?: string;
          dateTo?: string;
        },
  ): Promise<FdOMatch[]> {
    const params: Record<string, any> = {};

    if (typeof statusOrOptions === 'string') {
      params.status = statusOrOptions;
    } else if (statusOrOptions) {
      if (statusOrOptions.status) params.status = statusOrOptions.status;
      if (statusOrOptions.season !== undefined) params.season = String(statusOrOptions.season);
      if (statusOrOptions.matchday !== undefined) params.matchday = statusOrOptions.matchday;
      if (statusOrOptions.dateFrom) params.dateFrom = statusOrOptions.dateFrom;
      if (statusOrOptions.dateTo) params.dateTo = statusOrOptions.dateTo;
    }

    const data = await this.makeRequest<FdOMatchListResponse>('get', `/competitions/${competitionCode}/matches`, params);
    this.logger.log(`Fetched ${data?.resultSet?.count || 0} matches for ${competitionCode}`);
    return data?.matches || [];
  }

  /**
   * Get all matches (today's matches by default)
   */
  async getAllMatches(date?: string): Promise<FdOMatch[]> {
    const params: any = {};
    if (date) {
      params.date = date;
    }

    const data = await this.makeRequest<FdOMatchListResponse>('get', '/matches', params);
    return data?.matches || [];
  }

  /**
   * Get a specific match by ID
   */
  async getMatch(matchId: number): Promise<FdOMatch | null> {
    const data = await this.makeRequest<FdOMatch>('get', `/matches/${matchId}`);
    return data;
  }

  /**
   * Get teams in a competition
   */
  async getTeams(competitionCode: string): Promise<FdOTeam[]> {
    const data = await this.makeRequest<FdOTeamListResponse>('get', `/competitions/${competitionCode}/teams`);
    this.logger.log(`Fetched ${data?.count || 0} teams for ${competitionCode}`);
    return data?.teams || [];
  }

  /**
   * Get a specific team by ID
   */
  async getTeam(teamId: number): Promise<FdOTeam | null> {
    const data = await this.makeRequest<FdOTeam>('get', `/teams/${teamId}`);
    return data;
  }

  /**
   * Get standings for a competition
   */
  async getStandings(competitionCode: string): Promise<FdOStanding[]> {
    const data = await this.getStandingsResponse(competitionCode);
    if (!data?.standings?.length) return [];
    return data.standings;
  }

  /**
   * Get full standings response for a competition
   */
  async getStandingsResponse(competitionCode: string): Promise<FdOStandingResponse | null> {
    const data = await this.makeRequest<FdOStandingResponse>('get', `/competitions/${competitionCode}/standings`);
    return data ?? null;
  }

  /**
   * Get team's matches
   */
  async getTeamMatches(teamId: number, status?: string): Promise<FdOMatch[]> {
    const params: any = {};
    if (status) {
      params.status = status;
    }

    const data = await this.makeRequest<FdOMatchListResponse>('get', `/teams/${teamId}/matches`, params);
    return data?.matches || [];
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const data = await this.makeRequest<any>('get', '/competitions');
      if (data && data.competitions) {
        this.logger.log('Football-data.org connection successful');
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
