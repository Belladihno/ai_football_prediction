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

interface OddsApiEvent {
  id: number;
  home?: string;
  away?: string;
  home_team?: string;
  away_team?: string;
  homeTeam?: string;
  awayTeam?: string;
  date?: string;
  commence_time?: string;
}

interface OddsApiOddsResponse {
  id: number;
  bookmakers?: Record<
    string,
    Array<{
      name: string;
      odds: Array<{ home?: string; draw?: string; away?: string }>;
      updatedAt?: string;
    }>
  >;
}

@Injectable()
export class OddsApiService {
  private readonly logger = new Logger(OddsApiService.name);
  private client: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly bookmakers: string[];
  private readonly cacheTtlMs = 5 * 60 * 1000;
  private readonly eventsCache = new Map<string, { fetchedAt: number; events: OddsApiEvent[] }>();

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('oddsApi.apiKey') || '';
    this.baseUrl = this.configService.get<string>('oddsApi.baseUrl') || 'https://api.odds-api.io/v3';
    const bookmakers = this.configService.get<string>('oddsApi.bookmakers') || 'Bet365';
    this.bookmakers = bookmakers
      .split(',')
      .map(b => b.trim())
      .filter(Boolean);

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 5000,
    });
  }

  /**
   * Get odds for a specific fixture
   */
  async getOddsForFixture(
    fixtureId: number,
    leagueCode: string,
    homeTeam: string,
    awayTeam: string,
    kickoff: Date,
  ): Promise<OddsData | null> {
    if (!this.apiKey) {
      this.logger.warn('Odds API key not configured');
      return null;
    }

    try {
      const event = await this.findEvent(leagueCode, homeTeam, awayTeam, kickoff);
      if (!event) {
        return null;
      }

      const response = await this.client.get<OddsApiOddsResponse>('/odds', {
        params: {
          apiKey: this.apiKey,
          eventId: event.id,
          bookmakers: this.bookmakers.join(','),
        },
      });

      const odds = response.data;
      if (!odds || !odds.bookmakers) {
        return null;
      }

      const best = this.extractBestOdds(odds.bookmakers);
      if (!best) {
        return null;
      }

      return {
        homeWin: best.homeWin,
        draw: best.draw,
        awayWin: best.awayWin,
        bookmaker: best.bookmaker,
        lastUpdated: best.lastUpdated,
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
      this.logger.warn(`Skipping odds lookup without fixture context for ${fixtureId}`);
      const odds = null;
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
  private mapLeagueToSlug(leagueCode: string): string {
    const mapping: Record<string, string> = {
      PL: 'england-premier-league',
      PD: 'spain-la-liga',
      BL1: 'germany-bundesliga',
      SA: 'italy-serie-a',
      FL1: 'france-ligue-1',
    };
    return mapping[leagueCode] || '';
  }

  private normalizeTeamName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(fc|afc|cf|sc|club|de|the)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getEventTime(event: OddsApiEvent): Date | null {
    const raw = event.date || event.commence_time;
    if (!raw) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private async findEvent(
    leagueCode: string,
    homeTeam: string,
    awayTeam: string,
    kickoff: Date,
  ): Promise<OddsApiEvent | null> {
    const league = this.mapLeagueToSlug(leagueCode);
    const windowMs = 24 * 60 * 60 * 1000;
    const from = new Date(kickoff.getTime() - windowMs).toISOString();
    const to = new Date(kickoff.getTime() + windowMs).toISOString();
    const cacheKey = `${league}:${from.substring(0, 10)}:${to.substring(0, 10)}`;

    const cached = this.eventsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
      return this.matchEvent(cached.events, homeTeam, awayTeam, kickoff);
    }

    const response = await this.client.get('/events', {
      params: {
        apiKey: this.apiKey,
        sport: 'football',
        from,
        to,
        ...(league ? { league } : {}),
      },
    });

    const raw = response.data;
    const events: OddsApiEvent[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.data)
        ? raw.data
        : Array.isArray(raw?.events)
          ? raw.events
          : [];

    this.eventsCache.set(cacheKey, { fetchedAt: Date.now(), events });

    return this.matchEvent(events, homeTeam, awayTeam, kickoff);
  }

  private matchEvent(
    events: OddsApiEvent[],
    homeTeam: string,
    awayTeam: string,
    kickoff: Date,
  ): OddsApiEvent | null {
    if (!events.length) return null;

    const homeNorm = this.normalizeTeamName(homeTeam);
    const awayNorm = this.normalizeTeamName(awayTeam);
    let best: OddsApiEvent | null = null;
    let bestDiff = Number.MAX_SAFE_INTEGER;

    for (const event of events) {
      const eventHome = event.home || event.home_team || event.homeTeam || '';
      const eventAway = event.away || event.away_team || event.awayTeam || '';
      const eventHomeNorm = this.normalizeTeamName(eventHome);
      const eventAwayNorm = this.normalizeTeamName(eventAway);

      const directMatch = eventHomeNorm === homeNorm && eventAwayNorm === awayNorm;
      const swappedMatch = eventHomeNorm === awayNorm && eventAwayNorm === homeNorm;
      if (!directMatch && !swappedMatch) {
        continue;
      }

      const eventTime = this.getEventTime(event);
      if (!eventTime) {
        return event;
      }

      const diff = Math.abs(eventTime.getTime() - kickoff.getTime());
      if (diff < bestDiff) {
        bestDiff = diff;
        best = event;
      }
    }

    return best;
  }

  private extractBestOdds(
    bookmakers: OddsApiOddsResponse['bookmakers'],
  ): { homeWin: number; draw: number; awayWin: number; bookmaker: string; lastUpdated: Date } | null {
    if (!bookmakers) return null;

    let homeBest = 0;
    let drawBest = 0;
    let awayBest = 0;
    let updatedAt: Date | null = null;

    for (const [bookmakerName, markets] of Object.entries(bookmakers)) {
      for (const market of markets) {
        if (!['ML', '1X2', 'Match Winner', 'H2H'].includes(market.name)) {
          continue;
        }
        const entry = market.odds?.[0];
        if (!entry) continue;

        const home = parseFloat(entry.home || '');
        const draw = parseFloat(entry.draw || '');
        const away = parseFloat(entry.away || '');

        if (!Number.isNaN(home)) homeBest = Math.max(homeBest, home);
        if (!Number.isNaN(draw)) drawBest = Math.max(drawBest, draw);
        if (!Number.isNaN(away)) awayBest = Math.max(awayBest, away);

        if (!updatedAt && market.updatedAt) {
          updatedAt = new Date(market.updatedAt);
        }
      }
    }

    if (homeBest === 0 && drawBest === 0 && awayBest === 0) {
      return null;
    }

    return {
      homeWin: homeBest,
      draw: drawBest,
      awayWin: awayBest,
      bookmaker: 'best',
      lastUpdated: updatedAt || new Date(),
    };
  }
}
