import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { FeatureEngineeringService } from './feature-engineering.service';
import { MLInferenceService, EnsembleResult } from './ml-inference.service';
import { ConfidenceScoringService, PredictionWithConfidence } from './confidence-scoring.service';
import { Prediction, PredictionOutcome } from '../entities/prediction.entity';
import { Fixture } from '../../football/entities/fixture.entity';
import { FixtureStatus } from '../../football/entities/fixture.entity';

export interface PredictionResponse {
  id: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: Date;
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictedOutcome: 'HOME' | 'DRAW' | 'AWAY';
  confidence: number;
  display?: {
    summary: string;
    favorite: 'HOME' | 'DRAW' | 'AWAY';
    favoriteTeam: string;
    chancesPercent: { home: number; draw: number; away: number };
    confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH';
  };
  goals?: {
    expectedHomeGoals: number;
    expectedAwayGoals: number;
    expectedTotalGoals: number;
    mostLikelyScore: string; // e.g. "2-1"
    over25GoalsProb: number; // 0-1
    bttsProb: number; // both teams to score, 0-1
  };
  confidenceBreakdown: {
    dataQuality: number;
    modelCertainty: number;
    historicalAccuracy: number;
    contextualFactors: number;
  };
  modelVersion: string;
  modelContributions?: {
    [model: string]: { home: number; draw: number; away: number };
  };
  bestModel?: string;
  createdAt: Date;
}

@Injectable()
export class PredictionService {
  private readonly logger = new Logger(PredictionService.name);
  private readonly MODEL_VERSION = 'ensemble_v1'; // XGBoost + Logistic + Random Forest

  constructor(
    @InjectRepository(Prediction)
    private predictionRepository: Repository<Prediction>,
    @InjectRepository(Fixture)
    private fixtureRepository: Repository<Fixture>,
    private featureEngineeringService: FeatureEngineeringService,
    private mlInferenceService: MLInferenceService,
    private confidenceScoringService: ConfidenceScoringService,
  ) {}

  /**
   * Generate prediction for a fixture using ensemble
   */
  async generatePrediction(fixtureId: string, saveToDb: boolean = true): Promise<PredictionResponse> {
    const startTime = Date.now();

    this.logger.log(`Generating prediction for fixture ${fixtureId}`);

    // 1. Get fixture details
    const fixture = await this.fixtureRepository.findOne({
      where: { id: fixtureId },
      relations: ['homeTeam', 'awayTeam', 'league'],
    });

    if (!fixture) {
      throw new Error(`Fixture ${fixtureId} not found`);
    }

    // 2. Check if prediction already exists
    let prediction = await this.predictionRepository.findOne({
      where: { fixtureId },
    });

    if (prediction) {
      this.logger.log(`Prediction already exists for fixture ${fixtureId}`);
      return await this.toResponse(prediction, fixture);
    }

    // 3. Extract features
    const features = await this.featureEngineeringService.extractFeatures(fixtureId);

    // 4. Convert to array and run ensemble inference
    const featureArray = this.featureEngineeringService.featuresToArray(features);
    const ensembleResult: EnsembleResult = await this.mlInferenceService.predictEnsemble(featureArray);

    // 5. Calculate confidence with breakdown
    const predictionWithConfidence = await this.confidenceScoringService.calculateConfidence(
      ensembleResult.probabilities,
      features,
      this.MODEL_VERSION,
    );

    const display = this.buildDisplay(
      fixture,
      predictionWithConfidence.homeWinProb,
      predictionWithConfidence.drawProb,
      predictionWithConfidence.awayWinProb,
      predictionWithConfidence.predictedOutcome,
      predictionWithConfidence.confidence,
    );
    const goals = await this.predictGoalsFromHistory(fixture);

    // 6. Prepare model contributions for response
    const modelContributions: { [model: string]: { home: number; draw: number; away: number } } = {};
    for (const [modelName, probs] of Object.entries(ensembleResult.modelContributions)) {
      modelContributions[modelName] = {
        home: probs[0],
        draw: probs[1],
        away: probs[2],
      };
    }

    // 7. Save to database
    if (saveToDb) {
      prediction = this.predictionRepository.create({
        fixtureId,
        homeWinProb: predictionWithConfidence.homeWinProb,
        drawProb: predictionWithConfidence.drawProb,
        awayWinProb: predictionWithConfidence.awayWinProb,
        predictedOutcome: this.mapOutcome(predictionWithConfidence.predictedOutcome),
        confidence: predictionWithConfidence.confidence,
        confidenceBreakdown: predictionWithConfidence.confidenceBreakdown,
        features: features as any,
        modelVersion: this.MODEL_VERSION,
      });

      await this.predictionRepository.save(prediction);
      this.logger.log(`Saved prediction ${prediction.id} for fixture ${fixtureId}`);
    }

    const duration = Date.now() - startTime;
    this.logger.log(`Prediction completed in ${duration}ms (ensemble of ${Object.keys(ensembleResult.modelContributions).length} models)`);

    return {
      id: prediction?.id || 'pending',
      fixtureId,
      homeTeam: fixture.homeTeam?.name || 'Unknown',
      awayTeam: fixture.awayTeam?.name || 'Unknown',
      kickoff: fixture.kickoff,
      ...predictionWithConfidence,
      display,
      goals,
      modelContributions,
      bestModel: ensembleResult.bestModel,
      createdAt: prediction?.createdAt || new Date(),
    };
  }

  /**
   * Get prediction for a fixture
   */
  async getPrediction(fixtureId: string): Promise<PredictionResponse | null> {
    const prediction = await this.predictionRepository.findOne({
      where: { fixtureId },
    });

    if (!prediction) {
      return null;
    }

    const fixture = await this.fixtureRepository.findOne({
      where: { id: fixtureId },
      relations: ['homeTeam', 'awayTeam', 'league'],
    });

    return await this.toResponse(prediction, fixture!);
  }

  /**
   * Get today's predictions
   */
  async getTodayPredictions(): Promise<PredictionResponse[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const fixtures = await this.fixtureRepository.find({
      where: {
        kickoff: Between(today, tomorrow),
        status: In([FixtureStatus.SCHEDULED, FixtureStatus.TIMED]),
      },
      relations: ['homeTeam', 'awayTeam'],
    });

    const predictions: PredictionResponse[] = [];

    for (const fixture of fixtures) {
      let prediction = await this.predictionRepository.findOne({
        where: { fixtureId: fixture.id },
      });

      if (!prediction) {
        // Generate prediction if not exists
        try {
          const result = await this.generatePrediction(fixture.id);
          predictions.push(result);
        } catch (error) {
          this.logger.warn(`Failed to generate prediction for ${fixture.id}: ${error.message}`);
        }
      } else {
        predictions.push(await this.toResponse(prediction, fixture));
      }
    }

    return predictions;
  }

  /**
   * Get upcoming predictions (next N days)
   */
  async getUpcomingPredictions(days: number = 7): Promise<PredictionResponse[]> {
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const fixtures = await this.fixtureRepository.find({
      where: {
        kickoff: Between(now, endDate),
        status: In([FixtureStatus.SCHEDULED, FixtureStatus.TIMED]),
      },
      relations: ['homeTeam', 'awayTeam'],
      order: { kickoff: 'ASC' },
    });

    const predictions: PredictionResponse[] = [];

    for (const fixture of fixtures) {
      let prediction = await this.predictionRepository.findOne({
        where: { fixtureId: fixture.id },
      });

      if (!prediction) {
        try {
          const result = await this.generatePrediction(fixture.id);
          predictions.push(result);
        } catch (error) {
          this.logger.warn(`Failed to generate prediction for ${fixture.id}: ${error.message}`);
        }
      } else {
        predictions.push(await this.toResponse(prediction, fixture));
      }
    }

    return predictions;
  }

  /**
   * Get predictions by league
   */
  async getPredictionsByLeague(leagueCode: string, days: number = 7): Promise<PredictionResponse[]> {
    const now = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const fixtures = await this.fixtureRepository
      .createQueryBuilder('fixture')
      .leftJoinAndSelect('fixture.homeTeam', 'homeTeam')
      .leftJoinAndSelect('fixture.awayTeam', 'awayTeam')
      .leftJoinAndSelect('fixture.league', 'league')
      .where('fixture.kickoff BETWEEN :now AND :endDate', { now, endDate })
      .andWhere('fixture.status IN (:...statuses)', { statuses: [FixtureStatus.SCHEDULED, FixtureStatus.TIMED] })
      .andWhere('league.code = :leagueCode', { leagueCode })
      .orderBy('fixture.kickoff', 'ASC')
      .getMany();

    const predictions: PredictionResponse[] = [];

    for (const fixture of fixtures) {
      let prediction = await this.predictionRepository.findOne({
        where: { fixtureId: fixture.id },
      });

      if (!prediction) {
        try {
          const result = await this.generatePrediction(fixture.id);
          predictions.push(result);
        } catch (error) {
          // Ignore
        }
      } else {
        predictions.push(await this.toResponse(prediction, fixture));
      }
    }

    return predictions;
  }

  /**
   * Mark prediction result
   */
  async markResult(fixtureId: string, actualOutcome: string): Promise<void> {
    const prediction = await this.predictionRepository.findOne({
      where: { fixtureId },
    });

    if (!prediction) {
      throw new Error(`Prediction for fixture ${fixtureId} not found`);
    }

    prediction.actualOutcome = actualOutcome;
    prediction.isCorrect = prediction.predictedOutcome === actualOutcome;

    await this.predictionRepository.save(prediction);

    this.logger.log(`Marked prediction ${prediction.id}: actual=${actualOutcome}, correct=${prediction.isCorrect}`);
  }

  /**
   * Get model accuracy stats
   */
  async getAccuracyStats(): Promise<{
    total: number;
    correct: number;
    accuracy: number;
    byOutcome: {
      home: { correct: number; total: number; accuracy: number };
      draw: { correct: number; total: number; accuracy: number };
      away: { correct: number; total: number; accuracy: number };
    };
  }> {
    const predictions = await this.predictionRepository.find({
      where: {
        actualOutcome: 'HOME',
      },
    });

    const total = await this.predictionRepository
      .createQueryBuilder('pred')
      .where('pred.actualOutcome IS NOT NULL')
      .getCount();

    const correct = await this.predictionRepository
      .createQueryBuilder('pred')
      .where('pred.isCorrect = :isCorrect', { isCorrect: true })
      .getCount();

    // Get by outcome
    const homePreds = await this.predictionRepository.find({
      where: { predictedOutcome: PredictionOutcome.HOME },
    });
    const homeCorrect = homePreds.filter(p => p.isCorrect).length;

    const drawPreds = await this.predictionRepository.find({
      where: { predictedOutcome: PredictionOutcome.DRAW },
    });
    const drawCorrect = drawPreds.filter(p => p.isCorrect).length;

    const awayPreds = await this.predictionRepository.find({
      where: { predictedOutcome: PredictionOutcome.AWAY },
    });
    const awayCorrect = awayPreds.filter(p => p.isCorrect).length;

    return {
      total,
      correct,
      accuracy: total > 0 ? parseFloat((correct / total).toFixed(4)) : 0,
      byOutcome: {
        home: {
          correct: homeCorrect,
          total: homePreds.length,
          accuracy: homePreds.length > 0 ? parseFloat((homeCorrect / homePreds.length).toFixed(4)) : 0,
        },
        draw: {
          correct: drawCorrect,
          total: drawPreds.length,
          accuracy: drawPreds.length > 0 ? parseFloat((drawCorrect / drawPreds.length).toFixed(4)) : 0,
        },
        away: {
          correct: awayCorrect,
          total: awayPreds.length,
          accuracy: awayPreds.length > 0 ? parseFloat((awayCorrect / awayPreds.length).toFixed(4)) : 0,
        },
      },
    };
  }

  /**
   * Map outcome string to enum
   */
  private mapOutcome(outcome: string): PredictionOutcome {
    const mapping: Record<string, PredictionOutcome> = {
      'HOME': PredictionOutcome.HOME,
      'DRAW': PredictionOutcome.DRAW,
      'AWAY': PredictionOutcome.AWAY,
    };
    return mapping[outcome] || PredictionOutcome.HOME;
  }

  /**
   * Convert entity to response
   */
  private async toResponse(prediction: Prediction, fixture: Fixture): Promise<PredictionResponse> {
    const homeWinProb = Number(prediction.homeWinProb);
    const drawProb = Number(prediction.drawProb);
    const awayWinProb = Number(prediction.awayWinProb);
    const predictedOutcome = prediction.predictedOutcome;
    const confidence = Number(prediction.confidence);
    const goals = await this.predictGoalsFromHistory(fixture);

    return {
      id: prediction.id,
      fixtureId: prediction.fixtureId,
      homeTeam: fixture.homeTeam?.name || 'Unknown',
      awayTeam: fixture.awayTeam?.name || 'Unknown',
      kickoff: fixture.kickoff,
      homeWinProb,
      drawProb,
      awayWinProb,
      predictedOutcome,
      confidence,
      display: this.buildDisplay(
        fixture,
        homeWinProb,
        drawProb,
        awayWinProb,
        predictedOutcome as any,
        confidence,
      ),
      goals,
      confidenceBreakdown: prediction.confidenceBreakdown as any,
      modelVersion: prediction.modelVersion,
      createdAt: prediction.createdAt,
    };
  }

  private buildDisplay(
    fixture: Fixture,
    homeWinProb: number,
    drawProb: number,
    awayWinProb: number,
    predictedOutcome: 'HOME' | 'DRAW' | 'AWAY',
    confidence: number,
  ): PredictionResponse['display'] {
    const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v * 100)));

    const chancesPercent = {
      home: clampPct(homeWinProb),
      draw: clampPct(drawProb),
      away: clampPct(awayWinProb),
    };

    const favorite = predictedOutcome;
    const favoriteTeam =
      favorite === 'HOME' ? fixture.homeTeam?.name :
      favorite === 'AWAY' ? fixture.awayTeam?.name :
      'Draw';

    const confidenceLabel: 'LOW' | 'MEDIUM' | 'HIGH' =
      confidence >= 0.75 ? 'HIGH' :
      confidence >= 0.55 ? 'MEDIUM' :
      'LOW';

    const summary =
      favorite === 'DRAW'
        ? `Draw is the most likely result (${chancesPercent.draw}%).`
        : `${favoriteTeam} is the slight favorite (${favorite === 'HOME' ? chancesPercent.home : chancesPercent.away}%).`;

    return {
      summary,
      favorite,
      favoriteTeam,
      chancesPercent,
      confidenceLabel,
    };
  }

  private async predictGoalsFromHistory(fixture: Fixture): Promise<PredictionResponse['goals']> {
    const recentGames = 10;
    const [homeStats, awayStats] = await Promise.all([
      this.getTeamGoalStats(fixture.homeTeamId, recentGames),
      this.getTeamGoalStats(fixture.awayTeamId, recentGames),
    ]);

    const leagueAvgTotalGoals = await this.getLeagueAvgTotalGoals(fixture.leagueId);

    const fallbackPerTeam = Number.isFinite(leagueAvgTotalGoals) && leagueAvgTotalGoals > 0 ? leagueAvgTotalGoals / 2 : 1.35;

    const homeFor = homeStats.games > 0 ? homeStats.goalsFor / homeStats.games : fallbackPerTeam;
    const homeAgainst = homeStats.games > 0 ? homeStats.goalsAgainst / homeStats.games : fallbackPerTeam;
    const awayFor = awayStats.games > 0 ? awayStats.goalsFor / awayStats.games : fallbackPerTeam;
    const awayAgainst = awayStats.games > 0 ? awayStats.goalsAgainst / awayStats.games : fallbackPerTeam;

    // Simple expected goals model from recent scoring/conceding.
    const homeAdvantage = 1.05;
    const expectedHomeGoals = this.clampNumber(((homeFor + awayAgainst) / 2) * homeAdvantage, 0.2, 4.0);
    const expectedAwayGoals = this.clampNumber((awayFor + homeAgainst) / 2, 0.2, 4.0);
    const expectedTotalGoals = expectedHomeGoals + expectedAwayGoals;

    const maxGoals = 6;
    const homeDist = this.poissonDist(expectedHomeGoals, maxGoals);
    const awayDist = this.poissonDist(expectedAwayGoals, maxGoals);

    let best = { prob: -1, h: 0, a: 0 };
    for (let h = 0; h <= maxGoals; h++) {
      for (let a = 0; a <= maxGoals; a++) {
        const p = homeDist[h] * awayDist[a];
        if (p > best.prob) best = { prob: p, h, a };
      }
    }

    const lambdaTotal = expectedTotalGoals;
    const totalDist = this.poissonDist(lambdaTotal, 10);
    const under25 = totalDist[0] + totalDist[1] + totalDist[2];
    const over25GoalsProb = this.clampNumber(1 - under25, 0, 1);

    const pHome0 = homeDist[0] || 0;
    const pAway0 = awayDist[0] || 0;
    const bttsProb = this.clampNumber(1 - pHome0 - pAway0 + pHome0 * pAway0, 0, 1);

    return {
      expectedHomeGoals: Number(expectedHomeGoals.toFixed(2)),
      expectedAwayGoals: Number(expectedAwayGoals.toFixed(2)),
      expectedTotalGoals: Number(expectedTotalGoals.toFixed(2)),
      mostLikelyScore: `${best.h}-${best.a}`,
      over25GoalsProb: Number(over25GoalsProb.toFixed(4)),
      bttsProb: Number(bttsProb.toFixed(4)),
    };
  }

  private async getTeamGoalStats(teamId: string, recentGames: number): Promise<{ goalsFor: number; goalsAgainst: number; games: number }> {
    const fixtures = await this.fixtureRepository.createQueryBuilder('fixture')
      .where('(fixture.homeTeamId = :teamId OR fixture.awayTeamId = :teamId)', { teamId })
      .andWhere('fixture.status = :status', { status: FixtureStatus.FINISHED })
      .andWhere('fixture.homeGoals IS NOT NULL')
      .andWhere('fixture.awayGoals IS NOT NULL')
      .orderBy('fixture.kickoff', 'DESC')
      .take(recentGames)
      .getMany();

    let goalsFor = 0;
    let goalsAgainst = 0;

    for (const f of fixtures) {
      const isHome = f.homeTeamId === teamId;
      const gf = isHome ? (f.homeGoals ?? 0) : (f.awayGoals ?? 0);
      const ga = isHome ? (f.awayGoals ?? 0) : (f.homeGoals ?? 0);
      goalsFor += gf;
      goalsAgainst += ga;
    }

    return { goalsFor, goalsAgainst, games: fixtures.length };
  }

  private async getLeagueAvgTotalGoals(leagueId: string): Promise<number> {
    try {
      const row = await this.fixtureRepository.createQueryBuilder('fixture')
        .select('AVG((fixture.homeGoals + fixture.awayGoals))', 'avg')
        .where('fixture.leagueId = :leagueId', { leagueId })
        .andWhere('fixture.status = :status', { status: FixtureStatus.FINISHED })
        .andWhere('fixture.homeGoals IS NOT NULL')
        .andWhere('fixture.awayGoals IS NOT NULL')
        .getRawOne<{ avg: string | null }>();

      const avg = row?.avg ? Number(row.avg) : NaN;
      return Number.isFinite(avg) ? avg : NaN;
    } catch {
      return NaN;
    }
  }

  private poissonDist(lambda: number, maxK: number): number[] {
    const dist: number[] = new Array(maxK + 1).fill(0);
    dist[0] = Math.exp(-lambda);
    for (let k = 1; k <= maxK; k++) {
      dist[k] = dist[k - 1] * (lambda / k);
    }
    return dist;
  }

  private clampNumber(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }
}

