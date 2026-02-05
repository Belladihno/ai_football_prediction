import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, Between, LessThan } from 'typeorm';
import { ModelMetrics } from '../entities/model-metrics.entity';
import { Prediction } from '../../predictions/entities/prediction.entity';
import { PredictionOutcome } from '../../predictions/entities/prediction.entity';

export interface DriftStatus {
  isDrifting: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  currentAccuracy: number;
  previousAccuracy: number;
  dropPercentage: number;
}

export interface ModelPerformance {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  brierScore: number;
  homeAccuracy: number;
  drawAccuracy: number;
  awayAccuracy: number;
}

@Injectable()
export class ModelMonitoringService {
  private readonly logger = new Logger(ModelMonitoringService.name);
  private readonly ACCURACY_THRESHOLD = 0.45;
  private readonly DRIFT_THRESHOLD = 0.05;

  constructor(
    @InjectRepository(ModelMetrics)
    private modelMetricsRepository: Repository<ModelMetrics>,
    @InjectRepository(Prediction)
    private predictionRepository: Repository<Prediction>,
  ) {}

  /**
   * Track prediction accuracy after match result
   */
  async trackPredictionAccuracy(
    predictionId: string,
    actualOutcome: string,
  ): Promise<void> {
    try {
      const prediction = await this.predictionRepository.findOne({
        where: { id: predictionId },
      });

      if (!prediction) {
        this.logger.warn(`Prediction ${predictionId} not found`);
        return;
      }

      // Determine if prediction was correct
      const isCorrect = this.checkPrediction(
        prediction.predictedOutcome,
        actualOutcome,
      );

      // Update prediction
      prediction.actualOutcome = actualOutcome;
      prediction.isCorrect = isCorrect;
      await this.predictionRepository.save(prediction);

      // Update daily metrics
      await this.updateDailyMetrics(prediction.modelVersion, isCorrect);

      this.logger.log(`Tracked prediction ${predictionId}: ${isCorrect ? 'CORRECT' : 'INCORRECT'}`);
    } catch (error) {
      this.logger.error(`Failed to track prediction accuracy: ${error.message}`);
    }
  }

  /**
   * Update daily model metrics
   */
  private async updateDailyMetrics(modelVersion: string, isCorrect: boolean): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let metrics = await this.modelMetricsRepository.findOne({
      where: {
        modelVersion,
        date: today,
      },
    });

    if (!metrics) {
      metrics = this.modelMetricsRepository.create({
        modelVersion,
        date: today,
        accuracy: 0,
        brierScore: 0,
        totalPredictions: 0,
        correctPredictions: 0,
        confusionMatrix: {
          home: { predicted: 0, actual: 0 },
          draw: { predicted: 0, actual: 0 },
          away: { predicted: 0, actual: 0 },
        },
      });
    }

    metrics.totalPredictions++;
    if (isCorrect) {
      metrics.correctPredictions++;
    }

    // Recalculate accuracy
    metrics.accuracy = metrics.correctPredictions / metrics.totalPredictions;

    await this.modelMetricsRepository.save(metrics);

    // Check for alert conditions
    if (metrics.accuracy < this.ACCURACY_THRESHOLD) {
      await this.sendAccuracyAlert(modelVersion, metrics.accuracy);
    }
  }

  /**
   * Get model performance for a time period
   */
  async getModelPerformance(
    modelVersion: string,
    days: number = 30,
  ): Promise<ModelPerformance> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const predictions = await this.predictionRepository.find({
      where: {
        modelVersion,
        actualOutcome: LessThan(''), // Only predictions with actual outcomes
      },
    });

    const totalPredictions = predictions.length;
    const correctPredictions = predictions.filter(p => p.isCorrect).length;
    const accuracy = totalPredictions > 0 ? correctPredictions / totalPredictions : 0;

    // Calculate per-outcome accuracy
    const homePredictions = predictions.filter(p => p.predictedOutcome === PredictionOutcome.HOME);
    const drawPredictions = predictions.filter(p => p.predictedOutcome === PredictionOutcome.DRAW);
    const awayPredictions = predictions.filter(p => p.predictedOutcome === PredictionOutcome.AWAY);

    const homeCorrect = homePredictions.filter(p => p.isCorrect).length;
    const drawCorrect = drawPredictions.filter(p => p.isCorrect).length;
    const awayCorrect = awayPredictions.filter(p => p.isCorrect).length;

    // Calculate Brier score
    const brierScore = this.calculateBrierScore(predictions);

    return {
      totalPredictions,
      correctPredictions,
      accuracy: parseFloat(accuracy.toFixed(4)),
      brierScore: parseFloat(brierScore.toFixed(4)),
      homeAccuracy: homePredictions.length > 0 ? parseFloat((homeCorrect / homePredictions.length).toFixed(4)) : 0,
      drawAccuracy: drawPredictions.length > 0 ? parseFloat((drawCorrect / drawPredictions.length).toFixed(4)) : 0,
      awayAccuracy: awayPredictions.length > 0 ? parseFloat((awayCorrect / awayPredictions.length).toFixed(4)) : 0,
    };
  }

  /**
   * Calculate Brier score for probability calibration
   */
  private calculateBrierScore(predictions: Prediction[]): number {
    if (predictions.length === 0) return 0;

    let totalScore = 0;

    for (const prediction of predictions) {
      if (!prediction.actualOutcome) continue;

      const probs = {
        [PredictionOutcome.HOME]: Number(prediction.homeWinProb),
        [PredictionOutcome.DRAW]: Number(prediction.drawProb),
        [PredictionOutcome.AWAY]: Number(prediction.awayWinProb),
      };

      const actual = prediction.actualOutcome as keyof typeof probs;
      const actualProb = probs[actual] || 0;

      // Brier score = mean of squared differences
      const score = Math.pow(1 - actualProb, 2);
      totalScore += score;
    }

    return totalScore / predictions.length;
  }

  /**
   * Check for model drift
   */
  async checkModelDrift(modelVersion: string = 'ensemble_v1'): Promise<DriftStatus> {
    const last30Days = await this.getPeriodAccuracy(modelVersion, 30);
    const last7Days = await this.getPeriodAccuracy(modelVersion, 7);

    if (last30Days === 0) {
      return {
        isDrifting: false,
        severity: 'LOW',
        message: 'Insufficient data for drift detection',
        currentAccuracy: last7Days,
        previousAccuracy: 0,
        dropPercentage: 0,
      };
    }

    const dropPercentage = last30Days - last7Days;

    if (dropPercentage > this.DRIFT_THRESHOLD) {
      const severity = dropPercentage > 0.1 ? 'CRITICAL' : dropPercentage > 0.075 ? 'HIGH' : 'MEDIUM';

      this.logger.warn(`Model drift detected: ${(dropPercentage * 100).toFixed(2)}% accuracy drop`);

      return {
        isDrifting: true,
        severity,
        message: `Accuracy dropped by ${(dropPercentage * 100).toFixed(2)}% in the last 7 days`,
        currentAccuracy: last7Days,
        previousAccuracy: last30Days,
        dropPercentage,
      };
    }

    return {
      isDrifting: false,
      severity: 'LOW',
      message: 'No significant drift detected',
      currentAccuracy: last7Days,
      previousAccuracy: last30Days,
      dropPercentage,
    };
  }

  /**
   * Get average accuracy for a period
   */
  private async getPeriodAccuracy(modelVersion: string, days: number): Promise<number> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const predictions = await this.predictionRepository.find({
      where: {
        modelVersion,
        createdAt: MoreThan(startDate),
      },
    });

    if (predictions.length === 0) return 0;

    const correct = predictions.filter(p => p.isCorrect).length;
    return correct / predictions.length;
  }

  /**
   * Get accuracy history for charting
   */
  async getAccuracyHistory(
    modelVersion: string,
    days: number = 30,
  ): Promise<{ date: string; accuracy: number }[]> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const metrics = await this.modelMetricsRepository.find({
      where: {
        modelVersion,
        date: MoreThan(startDate),
      },
      order: { date: 'ASC' },
    });

    return metrics.map(m => ({
      date: m.date.toISOString().split('T')[0],
      accuracy: Number(m.accuracy),
    }));
  }

  /**
   * Send accuracy alert
   */
  private async sendAccuracyAlert(modelVersion: string, accuracy: number): Promise<void> {
    this.logger.warn(
      `[ALERT] Model ${modelVersion} accuracy dropped to ${(accuracy * 100).toFixed(2)}% (threshold: ${(this.ACCURACY_THRESHOLD * 100).toFixed(2)}%)`,
    );

    // In a real system, this would send email/Slack/pager alerts
    // For now, just log it
  }

  /**
   * Check if prediction was correct
   */
  private checkPrediction(
    predicted: PredictionOutcome,
    actual: string,
  ): boolean {
    return predicted === actual;
  }

  /**
   * Get model health summary
   */
  async getModelHealth(): Promise<{
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    accuracy: number;
    driftStatus: DriftStatus;
    totalPredictions: number;
    lastUpdated: Date;
  }> {
    const driftStatus = await this.checkModelDrift('ensemble_v1');
    const last7Days = await this.getPeriodAccuracy('ensemble_v1', 7);

    const predictions = await this.predictionRepository.find({
      order: { createdAt: 'DESC' },
      take: 1,
    });

    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    if (last7Days < this.ACCURACY_THRESHOLD) {
      status = 'CRITICAL';
    } else if (driftStatus.isDrifting) {
      status = 'WARNING';
    }

    return {
      status,
      accuracy: last7Days,
      driftStatus,
      totalPredictions: await this.predictionRepository.count(),
      lastUpdated: predictions[0]?.createdAt || new Date(),
    };
  }
}

