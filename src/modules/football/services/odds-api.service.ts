import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface OddsData {
  homeWin: number;
  draw: number;
  awayWin: number;
  bookmaker: string;
  lastUpdated: Date;
}

export interface MatchOdds {
  fixtureId: number;
  odds: OddsData[];
}

@Injectable()
export class OddsApiService {
  private readonly logger = new Logger(OddsApiService.name);
  private client: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('oddsapi.apiKey') || '';
    this.baseUrl = this.configService.get<string>('oddsapi.baseUrl') || 'https://api.the-odds-api.com/v4';

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 5000,
    });
  }

  /**
   * Get odds for a specific fixture
   */
  async getOddsForFixture(fixtureId: number, leagueCode: string): Promise<OddsData | null> {
    if (!this.apiKey) {
      this.logger.warn('Odds API key not configured');
      return null;
    }

    try {
      const response = await this.client.get(`/sports/${this.mapLeagueToSport(leagueCode)}/events/${fixtureId}/odds`, {
        params: {
          apiKey: this.apiKey,
          regions: 'eu,uk',
          markets: 'h2h',
        },
      });

      if (!response.data || !response.data.length) {
        return null;
      }

      // Get the best odds from all bookmakers
      const odds = response.data[0];
      const homeBest = Math.max(...odds.bookmakers.map((b: any) => b.markets[0]?.outcomes.find((o: any) => o.name === 'Home')?.price || 0));
      const drawBest = Math.max(...odds.bookmakers.map((b: any) => b.markets[0]?.outcomes.find((o: any) => o.name === 'Draw')?.price || 0));
      const awayBest = Math.max(...odds.bookmakers.map((b: any) => b.markets[0]?.outcomes.find((o: any) => o.name === 'Away')?.price || 0));

      return {
        homeWin: homeBest,
        draw: drawBest,
        awayWin: awayBest,
        bookmaker: odds.bookmakers[0]?.key || 'unknown',
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to fetch odds for fixture ${fixtureId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get odds for all upcoming matches in a league
   */
  async getLeagueOdds(leagueCode: string, fixtureIds: number[]): Promise<MatchOdds[]> {
    const results: MatchOdds[] = [];

    for (const fixtureId of fixtureIds) {
      const odds = await this.getOddsForFixture(fixtureId, leagueCode);
      if (odds) {
        results.push({
          fixtureId,
          odds: [odds],
        });
      }
    }

    return results;
  }

  /**
   * Convert decimal odds to implied probability
   */
  oddsToProbability(odds: number): number {
    return 1 / odds;
  }

  /**
   * Get market baseline (average implied probability from multiple sources)
   */
  getMarketBaseline(oddsData: OddsData): { homeProb: number; drawProb: number; awayProb: number } {
    return {
      homeProb: this.oddsToProbability(oddsData.homeWin),
      drawProb: this.oddsToProbability(oddsData.draw),
      awayProb: this.oddsToProbability(oddsData.awayWin),
    };
  }

  /**
   * Map league code to odds API sport code
   */
  private mapLeagueToSport(leagueCode: string): string {
    const mapping: Record<string, string> = {
      PL: 'soccer_epl',
      PD: 'soccer_la_liga',
      BL1: 'soccer_bundesliga',
      SA: 'soccer_serie_a',
      FL1: 'soccer_ligue_one',
    };
    return mapping[leagueCode] || 'soccer';
  }
}
