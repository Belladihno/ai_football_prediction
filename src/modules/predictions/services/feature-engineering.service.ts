import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fixture } from '../../football/entities/fixture.entity';
import { Team } from '../../football/entities/team.entity';
import { Standing } from '../../football/entities/standing.entity';
import { TeamService } from '../../football/services/team.service';
import { InjuryService } from '../../football/services/injury.service';
import { WeatherApiService } from '../../football/services/weather-api.service';
import { OddsApiService } from '../../football/services/odds-api.service';
import { FootballDataApiService } from '../../football/services/football-data-api.service';

export interface MatchFeatures {
  // Form features (6)
  homeLastFiveResults: string;
  awayLastFiveResults: string;
  homePointsPerGame: number;
  awayPointsPerGame: number;
  homeGoalsScoredPerGame: number;
  awayGoalsScoredPerGame: number;

  // Strength features (5)
  homeLeaguePosition: number;
  awayLeaguePosition: number;
  homeGoalDifference: number;
  awayGoalDifference: number;
  homeExpectedGoals: number;
  awayExpectedGoals: number;

  // H2H features (3)
  h2hLast5: string;
  homeH2HWins: number;
  h2hTotalGoalsAvg: number;

  // Context features (3)
  homeAdvantage: number;
  daysSinceLastMatchHome: number;
  daysSinceLastMatchAway: number;

  // Injury features (4)
  homeInjuriesCount: number;
  awayInjuriesCount: number;
  homeInjuryImpact: number;
  awayInjuryImpact: number;

  // Momentum features (4)
  homeWinStreak: number;
  awayWinStreak: number;
  homeUnbeatenStreak: number;
  awayUnbeatenStreak: number;

  // Managerial features (2)
  homeManagerTenure: number;
  awayManagerTenure: number;

  // Environmental features (2)
  weatherImpact: number;
  temperature: number;

  // Market feature (1)
  marketHomeProb: number;

  // Metadata
  fixtureId: string;
  leagueCode: string;
  lastUpdated: Date;
}

@Injectable()
export class FeatureEngineeringService {
  private readonly logger = new Logger(FeatureEngineeringService.name);

  constructor(
    @InjectRepository(Fixture)
    private fixtureRepository: Repository<Fixture>,
    @InjectRepository(Team)
    private teamRepository: Repository<Team>,
    @InjectRepository(Standing)
    private standingRepository: Repository<Standing>,
    private teamService: TeamService,
    private injuryService: InjuryService,
    private weatherService: WeatherApiService,
    private oddsService: OddsApiService,
    private footballApi: FootballDataApiService,
  ) {}

  /**
   * Extract all features for a fixture
   */
  async extractFeatures(fixtureId: string): Promise<MatchFeatures> {
    const fixture = await this.fixtureRepository.findOne({
      where: { id: fixtureId },
      relations: ['homeTeam', 'awayTeam', 'league'],
    });

    if (!fixture) {
      throw new Error(`Fixture ${fixtureId} not found`);
    }

    // Start building features
    const features: MatchFeatures = {
      fixtureId,
      leagueCode: fixture.league?.code || '',
      lastUpdated: new Date(),

      // Form features
      homeLastFiveResults: '',
      awayLastFiveResults: '',
      homePointsPerGame: 0,
      awayPointsPerGame: 0,
      homeGoalsScoredPerGame: 0,
      awayGoalsScoredPerGame: 0,

      // Strength features
      homeLeaguePosition: 10,
      awayLeaguePosition: 10,
      homeGoalDifference: 0,
      awayGoalDifference: 0,
      homeExpectedGoals: 1.5,
      awayExpectedGoals: 1.2,

      // H2H features
      h2hLast5: '',
      homeH2HWins: 0,
      h2hTotalGoalsAvg: 2.5,

      // Context features
      homeAdvantage: 1.0,
      daysSinceLastMatchHome: 7,
      daysSinceLastMatchAway: 7,

      // Injury features
      homeInjuriesCount: 0,
      awayInjuriesCount: 0,
      homeInjuryImpact: 0,
      awayInjuryImpact: 0,

      // Momentum features
      homeWinStreak: 0,
      awayWinStreak: 0,
      homeUnbeatenStreak: 0,
      awayUnbeatenStreak: 0,

      // Managerial features
      homeManagerTenure: 365,
      awayManagerTenure: 365,

      // Environmental features
      weatherImpact: 0,
      temperature: 15,

      // Market feature
      marketHomeProb: 0.45,
    };

    // Get form data from API
    try {
      features.homeLastFiveResults = await this.teamService.getForm(fixture.homeTeamId, 5);
      features.awayLastFiveResults = await this.teamService.getForm(fixture.awayTeamId, 5);
    } catch (error) {
      this.logger.warn(`Could not fetch form data: ${error.message}`);
    }

    // Get standing data
    try {
      const homeStanding = await this.standingRepository.findOne({
        where: { teamId: fixture.homeTeamId },
        order: { position: 'ASC' },
      });
      const awayStanding = await this.standingRepository.findOne({
        where: { teamId: fixture.awayTeamId },
        order: { position: 'ASC' },
      });

      if (homeStanding) {
        features.homeLeaguePosition = homeStanding.position;
        features.homeGoalDifference = homeStanding.goalDifference;
        features.homePointsPerGame = homeStanding.points / Math.max(homeStanding.gamesPlayed, 1);
      }

      if (awayStanding) {
        features.awayLeaguePosition = awayStanding.position;
        features.awayGoalDifference = awayStanding.goalDifference;
        features.awayPointsPerGame = awayStanding.points / Math.max(awayStanding.gamesPlayed, 1);
      }
    } catch (error) {
      this.logger.warn(`Could not fetch standing data: ${error.message}`);
    }

    // Get team goals per game
    const homeTeam = fixture.homeTeam;
    const awayTeam = fixture.awayTeam;

    if (homeTeam) {
      features.homeGoalsScoredPerGame = homeTeam.goalsScoredPerGame || 0;
    }
    if (awayTeam) {
      features.awayGoalsScoredPerGame = awayTeam.goalsScoredPerGame || 0;
    }

    // Get H2H data
    try {
      const h2hMatches = await this.footballApi.getTeamMatches(
        fixture.homeTeam.externalId,
        { limit: 10 },
      );

      const relevantH2H = h2hMatches.filter(
        m => m.status === 'FINISHED' &&
        ((m.homeTeam.id === fixture.homeTeam.externalId && m.awayTeam.id === fixture.awayTeam.externalId) ||
         (m.homeTeam.id === fixture.awayTeam.externalId && m.awayTeam.id === fixture.homeTeam.externalId))
      );

      let homeWins = 0;
      let awayWins = 0;
      let totalGoals = 0;

      for (const match of relevantH2H.slice(0, 5)) {
        const isHomeTeam = match.homeTeam.id === fixture.homeTeam.externalId;
        const homeGoals = isHomeTeam ? match.score.fullTime.home! : match.score.fullTime.away!;
        const awayGoals = isHomeTeam ? match.score.fullTime.away! : match.score.fullTime.home!;

        totalGoals += homeGoals + awayGoals;

        if (homeGoals > awayGoals) {
          isHomeTeam ? homeWins++ : awayWins++;
        }
      }

      features.homeH2HWins = homeWins;
      features.h2hTotalGoalsAvg = relevantH2H.length > 0 ? totalGoals / relevantH2H.length : 2.5;
      features.h2hLast5 = relevantH2H.slice(0, 5).map(m => {
        const isHomeTeam = m.homeTeam.id === fixture.homeTeam.externalId;
        const homeGoals = isHomeTeam ? m.score.fullTime.home! : m.score.fullTime.away!;
        const awayGoals = isHomeTeam ? m.score.fullTime.away! : m.score.fullTime.home!;

        if (homeGoals > awayGoals) return isHomeTeam ? 'W' : 'L';
        if (homeGoals < awayGoals) return isHomeTeam ? 'L' : 'W';
        return 'D';
      }).reverse().join('');
    } catch (error) {
      this.logger.warn(`Could not fetch H2H data: ${error.message}`);
    }

    return features;
  }

  /**
   * Convert features to array for model input
   */
  featuresToArray(features: MatchFeatures): number[] {
    return [
      // Form features
      this.formToNumber(features.homeLastFiveResults),
      this.formToNumber(features.awayLastFiveResults),
      features.homePointsPerGame,
      features.awayPointsPerGame,
      features.homeGoalsScoredPerGame,
      features.awayGoalsScoredPerGame,

      // Strength features (inverted position - higher is better)
      19 - features.homeLeaguePosition,
      19 - features.awayLeaguePosition,
      features.homeGoalDifference / 50, // Normalize
      features.awayGoalDifference / 50,
      features.homeExpectedGoals / 3,
      features.awayExpectedGoals / 3,

      // H2H features
      this.formToNumber(features.h2hLast5),
      features.homeH2HWins / 5,
      features.h2hTotalGoalsAvg / 5,

      // Context features
      features.homeAdvantage,
      Math.min(features.daysSinceLastMatchHome / 14, 1),
      Math.min(features.daysSinceLastMatchAway / 14, 1),

      // Injury features (inverted - more injuries = lower value)
      1 - Math.min(features.homeInjuriesCount / 5, 1),
      1 - Math.min(features.awayInjuriesCount / 5, 1),
      1 - features.homeInjuryImpact,
      1 - features.awayInjuryImpact,

      // Momentum features
      Math.min(features.homeWinStreak / 5, 1),
      Math.min(features.awayWinStreak / 5, 1),
      Math.min(features.homeUnbeatenStreak / 10, 1),
      Math.min(features.awayUnbeatenStreak / 10, 1),

      // Managerial features (normalized)
      Math.min(features.homeManagerTenure / 1000, 1),
      Math.min(features.awayManagerTenure / 1000, 1),

      // Environmental features
      features.weatherImpact,
      (features.temperature + 30) / 60, // Normalize -30 to 30

      // Market feature
      features.marketHomeProb,
    ];
  }

  /**
   * Convert W/D/L form string to number
   */
  private formToNumber(form: string): number {
    if (!form) return 0;
    let score = 0;
    for (const char of form) {
      if (char === 'W') score += 1;
      else if (char === 'D') score += 0.5;
    }
    return score / form.length;
  }
}
