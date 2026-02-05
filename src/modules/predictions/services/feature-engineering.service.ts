import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fixture, FixtureStatus } from '../../football/entities/fixture.entity';
import { Standing } from '../../football/entities/standing.entity';
import { DataQualityService } from '../../data-quality/services/data-quality.service';
import { InjuryService } from '../../football/services/injury.service';

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

interface LeagueTableEntry {
  position: number;
  played: number;
  pointsPerGame: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  goalDifference: number;
}

interface LeagueTableCacheEntry {
  expiresAt: number;
  tableByTeamId: Map<string, LeagueTableEntry>;
}

@Injectable()
export class FeatureEngineeringService {
  private readonly logger = new Logger(FeatureEngineeringService.name);
  private readonly leagueTableTtlMs = 15 * 60 * 1000; // 15 minutes
  private readonly leagueTableCache = new Map<string, LeagueTableCacheEntry>();
  private readonly standingsCache = new Map<string, { expiresAt: number; map: Map<string, Standing> }>();

  constructor(
    @InjectRepository(Fixture)
    private fixtureRepository: Repository<Fixture>,
    @InjectRepository(Standing)
    private standingRepository: Repository<Standing>,
    private dataQualityService: DataQualityService,
    private injuryService: InjuryService,
  ) { }

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

    // Start building features with defaults
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

      // Injury features (defaults - no external service)
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

      // Environmental features (defaults - no external service)
      weatherImpact: 0,
      temperature: 15,

      // Market feature (defaults - no external service)
      marketHomeProb: 0.45,
    };

    const kickoff = fixture.kickoff;
    const seasonStart = this.getSeasonStartDate(kickoff);

    // Get recent fixtures (from our DB, synced from football-data.org)
    const [homeRecent, awayRecent] = await Promise.all([
      this.getRecentFinishedFixtures(fixture.homeTeamId, kickoff, 10),
      this.getRecentFinishedFixtures(fixture.awayTeamId, kickoff, 10),
    ]);

    // Form + streaks + basic stats (DB-derived)
    const homeStats = this.computeTeamStatsFromFixtures(fixture.homeTeamId, homeRecent, kickoff);
    const awayStats = this.computeTeamStatsFromFixtures(fixture.awayTeamId, awayRecent, kickoff);

    features.homeLastFiveResults = homeStats.lastFiveForm;
    features.awayLastFiveResults = awayStats.lastFiveForm;
    features.homeWinStreak = homeStats.winStreak;
    features.awayWinStreak = awayStats.winStreak;
    features.homeUnbeatenStreak = homeStats.unbeatenStreak;
    features.awayUnbeatenStreak = awayStats.unbeatenStreak;
    features.daysSinceLastMatchHome = homeStats.daysSinceLastMatch ?? features.daysSinceLastMatchHome;
    features.daysSinceLastMatchAway = awayStats.daysSinceLastMatch ?? features.daysSinceLastMatchAway;
    features.homeGoalsScoredPerGame = homeStats.goalsForPerGame;
    features.awayGoalsScoredPerGame = awayStats.goalsForPerGame;

    // Use points per game from recent data as a fallback
    features.homePointsPerGame = homeStats.pointsPerGame;
    features.awayPointsPerGame = awayStats.pointsPerGame;

    // Season-to-date strength features from standings (preferred) or computed table
    try {
      const standings = await this.getStandingsCached(fixture.leagueId);
      const homeStanding = standings.get(fixture.homeTeamId);
      const awayStanding = standings.get(fixture.awayTeamId);

      if (homeStanding) {
        const played = homeStanding.playedGames || homeStanding.gamesPlayed || 0;
        features.homeLeaguePosition = homeStanding.position;
        features.homeGoalDifference = homeStanding.goalDifference;
        features.homePointsPerGame = played > 0 ? homeStanding.points / played : features.homePointsPerGame;
        features.homeGoalsScoredPerGame = played > 0 ? homeStanding.goalsFor / played : features.homeGoalsScoredPerGame;
      }
      if (awayStanding) {
        const played = awayStanding.playedGames || awayStanding.gamesPlayed || 0;
        features.awayLeaguePosition = awayStanding.position;
        features.awayGoalDifference = awayStanding.goalDifference;
        features.awayPointsPerGame = played > 0 ? awayStanding.points / played : features.awayPointsPerGame;
        features.awayGoalsScoredPerGame = played > 0 ? awayStanding.goalsFor / played : features.awayGoalsScoredPerGame;
      }

      let tableHome: LeagueTableEntry | undefined;
      let tableAway: LeagueTableEntry | undefined;
      if (!homeStanding || !awayStanding) {
        const table = await this.getLeagueTableCached(fixture.leagueId, seasonStart, kickoff);
        tableHome = table.tableByTeamId.get(fixture.homeTeamId);
        tableAway = table.tableByTeamId.get(fixture.awayTeamId);

        if (!homeStanding && tableHome) {
          features.homeLeaguePosition = tableHome.position;
          features.homeGoalDifference = tableHome.goalDifference;
          features.homePointsPerGame = tableHome.pointsPerGame;
          features.homeGoalsScoredPerGame = tableHome.goalsForPerGame;
        }
        if (!awayStanding && tableAway) {
          features.awayLeaguePosition = tableAway.position;
          features.awayGoalDifference = tableAway.goalDifference;
          features.awayPointsPerGame = tableAway.pointsPerGame;
          features.awayGoalsScoredPerGame = tableAway.goalsForPerGame;
        }
      }

      const homeFor = homeStanding
        ? (homeStanding.playedGames || homeStanding.gamesPlayed || 0) > 0 ? homeStanding.goalsFor / (homeStanding.playedGames || homeStanding.gamesPlayed) : homeStats.goalsForPerGame
        : tableHome?.goalsForPerGame ?? homeStats.goalsForPerGame;
      const homeAgainst = homeStanding
        ? (homeStanding.playedGames || homeStanding.gamesPlayed || 0) > 0 ? homeStanding.goalsAgainst / (homeStanding.playedGames || homeStanding.gamesPlayed) : homeStats.goalsAgainstPerGame
        : tableHome?.goalsAgainstPerGame ?? homeStats.goalsAgainstPerGame;
      const awayFor = awayStanding
        ? (awayStanding.playedGames || awayStanding.gamesPlayed || 0) > 0 ? awayStanding.goalsFor / (awayStanding.playedGames || awayStanding.gamesPlayed) : awayStats.goalsForPerGame
        : tableAway?.goalsForPerGame ?? awayStats.goalsForPerGame;
      const awayAgainst = awayStanding
        ? (awayStanding.playedGames || awayStanding.gamesPlayed || 0) > 0 ? awayStanding.goalsAgainst / (awayStanding.playedGames || awayStanding.gamesPlayed) : awayStats.goalsAgainstPerGame
        : tableAway?.goalsAgainstPerGame ?? awayStats.goalsAgainstPerGame;

      // Expected goals proxy (football-data.org doesn't provide xG)
      features.homeExpectedGoals = this.clampNumber(((homeFor + awayAgainst) / 2) * 1.05, 0.2, 4);
      features.awayExpectedGoals = this.clampNumber((awayFor + homeAgainst) / 2, 0.2, 4);
    } catch (error) {
      this.logger.warn(`Could not compute league table: ${error.message}`);
      // Fallback expected goals proxy from recent stats
      features.homeExpectedGoals = this.clampNumber(((homeStats.goalsForPerGame + awayStats.goalsAgainstPerGame) / 2) * 1.05, 0.2, 4);
      features.awayExpectedGoals = this.clampNumber((awayStats.goalsForPerGame + homeStats.goalsAgainstPerGame) / 2, 0.2, 4);
    }

    // Head-to-head from our DB (synced from football-data.org)
    try {
      const h2h = await this.getHeadToHeadFromDb(fixture.homeTeamId, fixture.awayTeamId, kickoff, 10);
      features.h2hLast5 = h2h.lastFiveForm;
      features.homeH2HWins = h2h.homeWinsLast5;
      features.h2hTotalGoalsAvg = h2h.avgTotalGoalsLast5;
    } catch (error) {
      this.logger.warn(`Could not fetch H2H data: ${error.message}`);
    }

    // Injuries (DB-backed, PL from FPL sync; non-PL from manual entries)
    try {
      const [homeInjury, awayInjury] = await Promise.all([
        this.injuryService.getTeamInjurySummary(fixture.homeTeamId),
        this.injuryService.getTeamInjurySummary(fixture.awayTeamId),
      ]);

      features.homeInjuriesCount = homeInjury.count;
      features.awayInjuriesCount = awayInjury.count;
      features.homeInjuryImpact = homeInjury.impact;
      features.awayInjuryImpact = awayInjury.impact;
    } catch (error) {
      this.logger.warn(`Could not fetch injury data: ${error.message}`);
    }

    // Market baseline proxy (no odds API): map points-per-game difference to a rough home win prior
    const ppgDiff = (features.homePointsPerGame || 0) - (features.awayPointsPerGame || 0);
    features.marketHomeProb = this.clampNumber(0.5 + ppgDiff * 0.12 + 0.03, 0.2, 0.8);

    // Data quality validation (helps confidence scoring + debugging)
    try {
      const homeFormStats = this.formStringToStats(features.homeLastFiveResults);
      const awayFormStats = this.formStringToStats(features.awayLastFiveResults);
      const h2hStats = this.formStringToStats(features.h2hLast5);
      const validation = this.dataQualityService.validateFeatures({
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        leagueCode: features.leagueCode,
        homeForm: homeFormStats,
        awayForm: awayFormStats,
        homeGoalsPerGame: features.homeGoalsScoredPerGame,
        awayGoalsPerGame: features.awayGoalsScoredPerGame,
        h2hData: {
          matchesPlayed: h2hStats.gamesPlayed,
          homeWins: h2hStats.wins,
          awayWins: h2hStats.losses,
          draws: h2hStats.draws,
        },
        lastUpdated: features.lastUpdated,
      });

      if (!validation.isValid || validation.issues.length > 0) {
        this.logger.warn(
          `Feature quality for fixture ${fixtureId}: confidence=${validation.confidence.toFixed(2)} issues=${validation.issues.join('; ')}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Could not validate feature quality: ${error.message}`);
    }

    return features;
  }

  /**
   * Convert features to array for model input
   */
  featuresToArray(features: MatchFeatures): number[] {
    return [
      // ===== FORM FEATURES (6) =====
      this.formToNumber(features.homeLastFiveResults),
      this.formToNumber(features.awayLastFiveResults),
      features.homePointsPerGame,
      features.awayPointsPerGame,
      features.homeGoalsScoredPerGame,
      features.awayGoalsScoredPerGame,

      // ===== STRENGTH FEATURES (5) =====
      features.homeLeaguePosition,
      features.awayLeaguePosition,
      features.homeGoalDifference / 50,
      features.awayGoalDifference / 50,
      features.homeExpectedGoals,
      features.awayExpectedGoals,

      // ===== H2H FEATURES (3) =====
      this.formToNumber(features.h2hLast5),
      features.homeH2HWins,
      features.h2hTotalGoalsAvg,

      // ===== CONTEXT FEATURES (3) =====
      features.homeAdvantage,
      Math.min(features.daysSinceLastMatchHome / 14, 1),
      Math.min(features.daysSinceLastMatchAway / 14, 1),

      // ===== INJURY FEATURES (4) =====
      Math.min(features.homeInjuriesCount / 5, 1),
      Math.min(features.awayInjuriesCount / 5, 1),
      1 - features.homeInjuryImpact,
      1 - features.awayInjuryImpact,

      // ===== MOMENTUM FEATURES (4) =====
      Math.min(features.homeWinStreak / 5, 1),
      Math.min(features.awayWinStreak / 5, 1),
      Math.min(features.homeUnbeatenStreak / 10, 1),
      Math.min(features.awayUnbeatenStreak / 10, 1),

      // ===== MANAGERIAL FEATURES (2) =====
      Math.min(features.homeManagerTenure / 1000, 1),
      Math.min(features.awayManagerTenure / 1000, 1),

      // ===== ENVIRONMENTAL FEATURES (2) =====
      features.weatherImpact,
      (features.temperature + 30) / 60,

      // ===== MARKET FEATURE (1) =====
      features.marketHomeProb,
    ];
  }

  /**
   * Validate extracted features and return quality score
   */
  validateFeatures(features: MatchFeatures): { isValid: boolean; qualityScore: number; issues: string[] } {
    const issues: string[] = [];
    let qualityScore = 1.0;

    // Check form data
    if (!features.homeLastFiveResults || features.homeLastFiveResults.length < 3) {
      issues.push('Insufficient home form data');
      qualityScore *= 0.85;
    }
    if (!features.awayLastFiveResults || features.awayLastFiveResults.length < 3) {
      issues.push('Insufficient away form data');
      qualityScore *= 0.85;
    }

    // Check H2H data
    if (!features.h2hLast5 || features.h2hLast5.length === 0) {
      issues.push('No head-to-head data available');
      qualityScore *= 0.9;
    }

    // Check league position data
    if (features.homeLeaguePosition === 10) {
      issues.push('Home team league position not found');
      qualityScore *= 0.95;
    }
    if (features.awayLeaguePosition === 10) {
      issues.push('Away team league position not found');
      qualityScore *= 0.95;
    }

    return {
      isValid: qualityScore >= 0.5,
      qualityScore,
      issues,
    };
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

  private async getRecentFinishedFixtures(teamId: string, before: Date, limit: number): Promise<Fixture[]> {
    return this.fixtureRepository.createQueryBuilder('fixture')
      .where('(fixture.homeTeamId = :teamId OR fixture.awayTeamId = :teamId)', { teamId })
      .andWhere('fixture.status = :status', { status: FixtureStatus.FINISHED })
      .andWhere('fixture.homeGoals IS NOT NULL')
      .andWhere('fixture.awayGoals IS NOT NULL')
      .andWhere('fixture.kickoff < :before', { before })
      .orderBy('fixture.kickoff', 'DESC')
      .take(limit)
      .getMany();
  }

  private computeTeamStatsFromFixtures(teamId: string, fixtures: Fixture[], referenceKickoff: Date): {
    lastFiveForm: string;
    goalsForPerGame: number;
    goalsAgainstPerGame: number;
    pointsPerGame: number;
    winStreak: number;
    unbeatenStreak: number;
    daysSinceLastMatch: number | null;
  } {
    if (fixtures.length === 0) {
      return {
        lastFiveForm: '',
        goalsForPerGame: 0,
        goalsAgainstPerGame: 0,
        pointsPerGame: 0,
        winStreak: 0,
        unbeatenStreak: 0,
        daysSinceLastMatch: null,
      };
    }

    const results: Array<'W' | 'D' | 'L'> = [];
    let goalsFor = 0;
    let goalsAgainst = 0;
    let points = 0;

    for (const f of fixtures) {
      const isHome = f.homeTeamId === teamId;
      const gf = isHome ? (f.homeGoals ?? 0) : (f.awayGoals ?? 0);
      const ga = isHome ? (f.awayGoals ?? 0) : (f.homeGoals ?? 0);
      goalsFor += gf;
      goalsAgainst += ga;

      let r: 'W' | 'D' | 'L';
      if (gf > ga) {
        r = 'W';
        points += 3;
      } else if (gf === ga) {
        r = 'D';
        points += 1;
      } else {
        r = 'L';
      }
      results.push(r);
    }

    const mostRecentKickoff = fixtures[0].kickoff;
    const daysSinceLastMatch = Math.max(
      0,
      Math.round((referenceKickoff.getTime() - mostRecentKickoff.getTime()) / (24 * 60 * 60 * 1000)),
    );

    // Streaks from most recent backwards
    let winStreak = 0;
    let unbeatenStreak = 0;
    for (const r of results) {
      if (r === 'W') winStreak++;
      else break;
    }
    for (const r of results) {
      if (r !== 'L') unbeatenStreak++;
      else break;
    }

    const lastFive = results.slice(0, 5).reverse().join(''); // oldest -> newest

    return {
      lastFiveForm: lastFive,
      goalsForPerGame: goalsFor / fixtures.length,
      goalsAgainstPerGame: goalsAgainst / fixtures.length,
      pointsPerGame: points / fixtures.length,
      winStreak,
      unbeatenStreak,
      daysSinceLastMatch,
    };
  }

  private async getHeadToHeadFromDb(homeTeamId: string, awayTeamId: string, before: Date, limit: number): Promise<{
    lastFiveForm: string;
    homeWinsLast5: number;
    avgTotalGoalsLast5: number;
  }> {
    const fixtures = await this.fixtureRepository.createQueryBuilder('fixture')
      .where('fixture.status = :status', { status: FixtureStatus.FINISHED })
      .andWhere('fixture.homeGoals IS NOT NULL')
      .andWhere('fixture.awayGoals IS NOT NULL')
      .andWhere(
        '((fixture.homeTeamId = :home AND fixture.awayTeamId = :away) OR (fixture.homeTeamId = :away AND fixture.awayTeamId = :home))',
        { home: homeTeamId, away: awayTeamId },
      )
      .andWhere('fixture.kickoff < :before', { before })
      .orderBy('fixture.kickoff', 'DESC')
      .take(limit)
      .getMany();

    const lastFive = fixtures.slice(0, 5);
    let homeWins = 0;
    let totalGoals = 0;

    const results: Array<'W' | 'D' | 'L'> = [];
    for (const f of lastFive) {
      const homeWasHome = f.homeTeamId === homeTeamId;
      const homeGoals = homeWasHome ? (f.homeGoals ?? 0) : (f.awayGoals ?? 0);
      const awayGoals = homeWasHome ? (f.awayGoals ?? 0) : (f.homeGoals ?? 0);

      totalGoals += homeGoals + awayGoals;

      if (homeGoals > awayGoals) {
        results.push('W');
        homeWins++;
      } else if (homeGoals === awayGoals) {
        results.push('D');
      } else {
        results.push('L');
      }
    }

    return {
      lastFiveForm: results.reverse().join(''),
      homeWinsLast5: homeWins,
      avgTotalGoalsLast5: lastFive.length > 0 ? totalGoals / lastFive.length : 2.5,
    };
  }

  private async getLeagueTableCached(leagueId: string, seasonStart: Date, before: Date): Promise<{
    tableByTeamId: Map<string, LeagueTableEntry>;
  }> {
    const seasonYear = seasonStart.getUTCFullYear();
    const asOf = before.toISOString().slice(0, 10);
    const cacheKey = `${leagueId}:${seasonYear}:${asOf}`;

    const cached = this.leagueTableCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    const fixtures = await this.fixtureRepository.createQueryBuilder('fixture')
      .where('fixture.leagueId = :leagueId', { leagueId })
      .andWhere('fixture.status = :status', { status: FixtureStatus.FINISHED })
      .andWhere('fixture.homeGoals IS NOT NULL')
      .andWhere('fixture.awayGoals IS NOT NULL')
      .andWhere('fixture.kickoff >= :seasonStart', { seasonStart })
      .andWhere('fixture.kickoff < :before', { before })
      .getMany();

    const stats = new Map<string, { points: number; played: number; gf: number; ga: number }>();
    const ensure = (teamId: string) => {
      if (!stats.has(teamId)) stats.set(teamId, { points: 0, played: 0, gf: 0, ga: 0 });
      return stats.get(teamId)!;
    };

    for (const f of fixtures) {
      const hg = f.homeGoals ?? 0;
      const ag = f.awayGoals ?? 0;

      const home = ensure(f.homeTeamId);
      const away = ensure(f.awayTeamId);

      home.played += 1;
      away.played += 1;
      home.gf += hg;
      home.ga += ag;
      away.gf += ag;
      away.ga += hg;

      if (hg > ag) home.points += 3;
      else if (hg < ag) away.points += 3;
      else {
        home.points += 1;
        away.points += 1;
      }
    }

    const rows = Array.from(stats.entries()).map(([teamId, s]) => ({
      teamId,
      points: s.points,
      played: s.played,
      gd: s.gf - s.ga,
      gf: s.gf,
      ga: s.ga,
    }));

    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.gd !== a.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });

    const tableByTeamId = new Map<string, LeagueTableEntry>();
    rows.forEach((r, idx) => {
      tableByTeamId.set(r.teamId, {
        position: idx + 1,
        played: r.played,
        pointsPerGame: r.played > 0 ? r.points / r.played : 0,
        goalsForPerGame: r.played > 0 ? r.gf / r.played : 0,
        goalsAgainstPerGame: r.played > 0 ? r.ga / r.played : 0,
        goalDifference: r.gd,
      });
    });

    const value: LeagueTableCacheEntry = { expiresAt: Date.now() + this.leagueTableTtlMs, tableByTeamId };
    this.leagueTableCache.set(cacheKey, value);

    return value;
  }

  private async getStandingsCached(leagueId: string): Promise<Map<string, Standing>> {
    const cacheKey = `${leagueId}`;
    const cached = this.standingsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.map;
    }

    const rows = await this.standingRepository.find({ where: { leagueId } });
    const map = new Map<string, Standing>();
    rows.forEach(r => map.set(r.teamId, r));

    this.standingsCache.set(cacheKey, { expiresAt: Date.now() + this.leagueTableTtlMs, map });
    return map;
  }

  private getSeasonStartDate(kickoff: Date): Date {
    const year = kickoff.getUTCFullYear();
    const month = kickoff.getUTCMonth(); // 0=Jan
    const seasonStartYear = month >= 6 ? year : year - 1; // July 1st
    return new Date(Date.UTC(seasonStartYear, 6, 1, 0, 0, 0));
  }

  private formStringToStats(form: string): { gamesPlayed: number; wins: number; draws: number; losses: number } {
    const results = (form || '').split('') as Array<'W' | 'D' | 'L'>;
    const wins = results.filter(r => r === 'W').length;
    const draws = results.filter(r => r === 'D').length;
    const losses = results.filter(r => r === 'L').length;
    return { gamesPlayed: results.length, wins, draws, losses };
  }

  private clampNumber(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }
}
