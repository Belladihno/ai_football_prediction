import { Injectable, Logger } from '@nestjs/common';
import { FootballDataApiService } from './football-data-api.service';
import { WeatherApiService, WeatherData } from './weather-api.service';
import { OddsApiService, OddsData } from './odds-api.service';
import { InjuryService } from './injury.service';
import { CacheService } from '../../../common/services/cache.service';

export interface AggregatedMatchData {
  fixtureId: number;
  homeTeam: {
    id: number;
    name: string;
    form: string;
    goalsPerGame: number;
    injuries: number;
    injuryImpact: number;
    leaguePosition: number;
  };
  awayTeam: {
    id: number;
    name: string;
    form: string;
    goalsPerGame: number;
    injuries: number;
    injuryImpact: number;
    leaguePosition: number;
  };
  h2h: {
    homeWins: number;
    awayWins: number;
    draws: number;
    avgGoals: number;
    lastFiveResults: string;
  };
  weather?: {
    temperature: number;
    condition: string;
    impact: number;
  };
  odds?: {
    homeWin: number;
    draw: number;
    awayWin: number;
    homeProb: number;
    drawProb: number;
    awayProb: number;
  };
  metadata: {
    league: string;
    kickoff: Date;
    venue: string;
    lastUpdated: Date;
  };
}

// Default weather when API is unavailable
const defaultWeather = {
  temperature: 15,
  condition: 'Clear',
  impact: 0,
};

// Default odds when API is unavailable
const defaultOdds = {
  homeWin: 2.1,
  draw: 3.2,
  awayWin: 3.5,
  homeProb: 0.43,
  drawProb: 0.29,
  awayProb: 0.28,
};

@Injectable()
export class DataAggregatorService {
  private readonly logger = new Logger(DataAggregatorService.name);

  constructor(
    private footballApi: FootballDataApiService,
    private weatherService: WeatherApiService,
    private oddsService: OddsApiService,
    private injuryService: InjuryService,
    private cacheService: CacheService,
  ) {}

  /**
   * Aggregate all data for a match
   */
  async aggregateMatchData(
    fixtureId: number,
    leagueCode: string,
    venue: string,
    kickoff: Date,
  ): Promise<AggregatedMatchData> {
    // Check cache first
    const cacheKey = `aggregated:${fixtureId}`;
    const cached = await this.cacheService.get<AggregatedMatchData>(cacheKey);
    if (cached) {
      return cached;
    }

    // Fetch all data in parallel
    const [fixture, weather, odds, injuries] = await Promise.all([
      this.footballApi.getFixture(fixtureId),
      this.getCachedWeather(venue),
      this.getCachedOdds(fixtureId, leagueCode),
      this.getInjuriesForMatch(leagueCode),
    ]);

    if (!fixture) {
      throw new Error(`Fixture ${fixtureId} not found`);
    }

    // Build aggregated data
    const homeTeam = fixture.homeTeam;
    const awayTeam = fixture.awayTeam;

    const aggregated: AggregatedMatchData = {
      fixtureId,
      homeTeam: {
        id: homeTeam.id,
        name: homeTeam.name,
        form: '',
        goalsPerGame: 1.8,
        injuries: injuries.homeCount,
        injuryImpact: injuries.homeImpact,
        leaguePosition: 8,
      },
      awayTeam: {
        id: awayTeam.id,
        name: awayTeam.name,
        form: '',
        goalsPerGame: 1.5,
        injuries: injuries.awayCount,
        injuryImpact: injuries.awayImpact,
        leaguePosition: 10,
      },
      h2h: {
        homeWins: 0,
        awayWins: 0,
        draws: 0,
        avgGoals: 2.5,
        lastFiveResults: '',
      },
      weather: weather ? {
        temperature: weather.temperature,
        condition: weather.condition,
        impact: this.weatherService.getWeatherImpact(weather),
      } : undefined,
      odds: odds ? {
        homeWin: odds.homeWin,
        draw: odds.draw,
        awayWin: odds.awayWin,
        ...this.oddsService.getMarketBaseline(odds),
      } : undefined,
      metadata: {
        league: leagueCode,
        kickoff,
        venue,
        lastUpdated: new Date(),
      },
    };

    // Get H2H data
    try {
      const h2hMatches = await this.footballApi.getTeamMatches(homeTeam.id, { limit: 10 });
      const relevantH2H = h2hMatches.filter(
        m => m.status === 'FINISHED' &&
        ((m.homeTeam.id === homeTeam.id && m.awayTeam.id === awayTeam.id) ||
         (m.homeTeam.id === awayTeam.id && m.awayTeam.id === homeTeam.id))
      );

      let homeWins = 0;
      let awayWins = 0;
      let draws = 0;
      let totalGoals = 0;

      for (const match of relevantH2H.slice(0, 5)) {
        const isHomeTeam = match.homeTeam.id === homeTeam.id;
        const homeGoals = isHomeTeam ? match.score.fullTime.home! : match.score.fullTime.away!;
        const awayGoals = isHomeTeam ? match.score.fullTime.away! : match.score.fullTime.home!;

        totalGoals += homeGoals + awayGoals;

        if (homeGoals > awayGoals) {
          isHomeTeam ? homeWins++ : awayWins++;
        } else if (homeGoals === awayGoals) {
          draws++;
        }
      }

      aggregated.h2h = {
        homeWins,
        awayWins,
        draws,
        avgGoals: relevantH2H.length > 0 ? totalGoals / relevantH2H.length : 2.5,
        lastFiveResults: relevantH2H.slice(0, 5).map(m => {
          const isHomeTeam = m.homeTeam.id === homeTeam.id;
          const homeGoals = isHomeTeam ? m.score.fullTime.home! : m.score.fullTime.away!;
          const awayGoals = isHomeTeam ? m.score.fullTime.away! : m.score.fullTime.home!;

          if (homeGoals > awayGoals) return isHomeTeam ? 'W' : 'L';
          if (homeGoals < awayGoals) return isHomeTeam ? 'L' : 'W';
          return 'D';
        }).reverse().join(''),
      };
    } catch (error) {
      this.logger.warn(`Could not fetch H2H data: ${error.message}`);
    }

    // Cache for 1 hour
    await this.cacheService.set(cacheKey, aggregated, 3600);

    return aggregated;
  }

  /**
   * Get weather with caching
   */
  private async getCachedWeather(venue: string): Promise<WeatherData | null> {
    const cacheKey = `weather:${venue}`;
    const cached = await this.cacheService.get<WeatherData>(cacheKey);
    if (cached) return cached;

    const weather = await this.weatherService.getWeatherByCity(venue);
    if (weather) {
      await this.cacheService.set(cacheKey, weather, 21600); // 6 hours
    }
    return weather;
  }

  /**
   * Get odds with caching
   */
  private async getCachedOdds(fixtureId: number, leagueCode: string): Promise<OddsData | null> {
    const cacheKey = `odds:${fixtureId}`;
    const cached = await this.cacheService.get<OddsData>(cacheKey);
    if (cached) return cached;

    const odds = await this.oddsService.getOddsForFixture(fixtureId, leagueCode);
    if (odds) {
      await this.cacheService.set(cacheKey, odds, 43200); // 12 hours
    }
    return odds;
  }

  /**
   * Get injuries for both teams in a match
   */
  private async getInjuriesForMatch(leagueCode: string) {
    if (leagueCode === 'PL') {
      try {
        const injuries = await this.injuryService.getPremierLeagueInjuries();
        return {
          homeCount: Math.floor(injuries.length / 2),
          awayCount: Math.floor(injuries.length / 2),
          homeImpact: injuries.length > 0 ? injuries.slice(0, 3).reduce((sum, i) => sum + i.impact, 0) / 3 : 0,
          awayImpact: injuries.length > 0 ? injuries.slice(-3).reduce((sum, i) => sum + i.impact, 0) / 3 : 0,
        };
      } catch {
        return { homeCount: 0, awayCount: 0, homeImpact: 0, awayImpact: 0 };
      }
    }

    return { homeCount: 0, awayCount: 0, homeImpact: 0, awayImpact: 0 };
  }

  /**
   * Get data quality score for aggregated data
   */
  getDataQualityScore(data: AggregatedMatchData): number {
    let score = 0;

    // Team data (always available)
    score += 0.3;

    // H2H data (70% chance available)
    if (data.h2h.lastFiveResults) score += 0.2;

    // Weather data (50% chance available)
    if (data.weather && data.weather.temperature !== 15) score += 0.15;

    // Odds data (50% chance available)
    if (data.odds && data.odds.homeWin !== 2.1) score += 0.15;

    // Injury data (30% chance available)
    if (data.homeTeam.injuries > 0 || data.awayTeam.injuries > 0) score += 0.1;

    // League position (would need standings)
    if (data.homeTeam.leaguePosition !== 8) score += 0.1;

    return score;
  }
}
