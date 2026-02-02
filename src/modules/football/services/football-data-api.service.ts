import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

// Types for API responses
export interface ApiCompetition {
  id: number;
  name: string;
  code: string;
  area: { name: string; flag: string };
}

export interface ApiTeam {
  id: number;
  name: string;
  shortName: string;
  tla: string;
  crestUrl: string;
  address: string;
  website: string;
  founded: number;
  clubColors: string;
  venue: string;
  area: { name: string };
}

export interface ApiFixture {
  id: number;
  competition: { id: number };
  utcDate: string;
  matchday: number;
  status: string;
  homeTeam: { id: number; name: string };
  awayTeam: { id: number; name: string };
  score: {
    winner: string;
    homeTeam: number | null;
    awayTeam: number | null;
    fullTime: { home: number | null; away: number | null };
    halfTime: { home: number | null; away: number | null };
  };
  venue: string;
  referee: string | null;
}

@Injectable()
export class FootballDataApiService {
  private readonly logger = new Logger(FootballDataApiService.name);
  private client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('footballApi.baseUrl') || 'https://api.football-data.org/v4';
    this.apiKey = this.configService.get<string>('footballApi.apiKey') || '';

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-Auth-Token': this.apiKey,
      },
      timeout: 10000,
    });
  }

  // Get competition/league info
  async getCompetition(competitionCode: string): Promise<ApiCompetition | null> {
    try {
      const response = await this.client.get(`/competitions/${competitionCode}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch competition ${competitionCode}: ${error.message}`);
      return null;
    }
  }

  // Get teams in a competition
  async getTeams(competitionCode: string): Promise<ApiTeam[]> {
    try {
      const response = await this.client.get(`/competitions/${competitionCode}/teams`);
      return response.data.teams || [];
    } catch (error) {
      this.logger.error(`Failed to fetch teams for ${competitionCode}: ${error.message}`);
      return [];
    }
  }

  // Get single team
  async getTeam(teamId: number): Promise<ApiTeam | null> {
    try {
      const response = await this.client.get(`/teams/${teamId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch team ${teamId}: ${error.message}`);
      return null;
    }
  }

  // Get matches for a competition
  async getMatches(
    competitionCode: string,
    options?: {
      matchday?: number;
      dateFrom?: string;
      dateTo?: string;
      status?: string;
    },
  ): Promise<ApiFixture[]> {
    try {
      const params: Record<string, any> = {};
      if (options?.matchday) params.matchday = options.matchday;
      if (options?.dateFrom) params.dateFrom = options.dateFrom;
      if (options?.dateTo) params.dateTo = options.dateTo;
      if (options?.status) params.status = options.status;

      const response = await this.client.get(`/competitions/${competitionCode}/matches`, { params });
      return response.data.matches || [];
    } catch (error) {
      this.logger.error(`Failed to fetch matches for ${competitionCode}: ${error.message}`);
      return [];
    }
  }

  // Get upcoming matches (next 7 days)
  async getUpcomingMatches(competitionCode: string): Promise<ApiFixture[]> {
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const dateFrom = today.toISOString().split('T')[0];
    const dateTo = nextWeek.toISOString().split('T')[0];

    return this.getMatches(competitionCode, { dateFrom, dateTo });
  }

  // Get matches for a specific team
  async getTeamMatches(teamId: number, options?: { limit?: number }): Promise<ApiFixture[]> {
    try {
      const params: Record<string, any> = {};
      if (options?.limit) params.limit = options.limit;

      const response = await this.client.get(`/teams/${teamId}/matches`, { params });
      return response.data.matches || [];
    } catch (error) {
      this.logger.error(`Failed to fetch matches for team ${teamId}: ${error.message}`);
      return [];
    }
  }

  // Get single fixture
  async getFixture(fixtureId: number): Promise<ApiFixture | null> {
    try {
      const response = await this.client.get(`/matches/${fixtureId}`);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch fixture ${fixtureId}: ${error.message}`);
      return null;
    }
  }
}
