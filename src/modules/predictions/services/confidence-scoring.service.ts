import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Prediction } from '../entities/prediction.entity';
import { ModelMetrics } from '../../ml-monitoring/entities/model-metrics.entity';
import { MatchFeatures } from './feature-engineering.service';
import { MLInferenceService } from './ml-inference.service';

export interface ConfidenceBreakdown {
  dataQuality: number;
  modelCertainty: number;
  historicalAccuracy: number;
  contextualFactors: number;
}

export interface PredictionWithConfidence {
  homeWinProb: number;
  drawProb: number;
  awayWinProb: number;
  predictedOutcome: 'HOME' | 'DRAW' | 'AWAY';
  confidence: number;
  confidenceBreakdown: ConfidenceBreakdown;
  modelVersion: string;
}

@Injectable()
export class ConfidenceScoringService {
  private readonly logger = new Logger(ConfidenceScoringService.name);

  constructor(
    @InjectRepository(Prediction)
    private predictionRepository: Repository<Prediction>,
    @InjectRepository(ModelMetrics)
    private modelMetricsRepository: Repository<ModelMetrics>,
    private mlInferenceService: MLInferenceService,
  ) {}

  /**
   * Calculate overall confidence with detailed breakdown
   */
  async calculateConfidence(
    probabilities: number[],
    features: MatchFeatures,
    modelVersion: string,
  ): Promise<PredictionWithConfidence> {
    const breakdown = await this.getConfidenceBreakdown(features, probabilities);

    // Weighted average for overall confidence
    const weights = {
      dataQuality: 0.25,
      modelCertainty: 0.30,
      historicalAccuracy: 0.30,
      contextualFactors: 0.15,
    };

    const overallConfidence = 
      breakdown.dataQuality * weights.dataQuality +
      breakdown.modelCertainty * weights.modelCertainty +
      breakdown.historicalAccuracy * weights.historicalAccuracy +
      breakdown.contextualFactors * weights.contextualFactors;

    // Determine predicted outcome
    const outcomeMap = ['HOME', 'DRAW', 'AWAY'] as const;
    const predictedOutcome = outcomeMap[probabilities.indexOf(Math.max(...probabilities))];

    return {
      homeWinProb: parseFloat(probabilities[0].toFixed(4)),
      drawProb: parseFloat(probabilities[1].toFixed(4)),
      awayWinProb: parseFloat(probabilities[2].toFixed(4)),
      predictedOutcome,
      confidence: parseFloat(Math.max(overallConfidence, 0.3).toFixed(4)),
      confidenceBreakdown: breakdown,
      modelVersion,
    };
  }

  /**
   * Get detailed confidence breakdown
   */
  private async getConfidenceBreakdown(
    features: MatchFeatures,
    probabilities: number[],
  ): Promise<ConfidenceBreakdown> {
    return {
      dataQuality: this.assessDataQuality(features),
      modelCertainty: this.assessModelCertainty(probabilities),
      historicalAccuracy: await this.getHistoricalAccuracy(),
      contextualFactors: this.assessContextualFactors(features),
    };
  }

  /**
   * Assess data quality from features
   */
  private assessDataQuality(features: MatchFeatures): number {
    let score = 1.0;

    // Check form data availability
    if (!features.homeLastFiveResults || features.homeLastFiveResults.length < 3) {
      score *= 0.85;
    }
    if (!features.awayLastFiveResults || features.awayLastFiveResults.length < 3) {
      score *= 0.85;
    }

    // Check standing data
    if (features.homeLeaguePosition === 10) { // Default value
      score *= 0.9;
    }
    if (features.awayLeaguePosition === 10) {
      score *= 0.9;
    }

    // Check H2H data
    if (!features.h2hLast5 || features.h2hLast5.length === 0) {
      score *= 0.85;
    }

    // Check injury data
    if (features.homeInjuriesCount === 0 && features.awayInjuriesCount === 0) {
      // Could be missing data, not necessarily good
      score *= 0.95;
    }

    // Check market odds
    if (features.marketHomeProb === 0.45) { // Default value
      score *= 0.9;
    }

    return Math.max(score, 0.3);
  }

  /**
   * Assess model certainty from probability distribution
   */
  private assessModelCertainty(probabilities: number[]): number {
    const maxProb = Math.max(...probabilities);
    const minProb = Math.min(...probabilities);
    const spread = maxProb - minProb;

    // Higher spread = more certain
    if (maxProb > 0.6) return 0.9;
    if (maxProb > 0.5) return 0.75;
    if (spread < 0.15) return 0.5; // Very uncertain
    if (spread < 0.25) return 0.65;

    return 0.7;
  }

  /**
   * Get historical model accuracy
   */
  private async getHistoricalAccuracy(): Promise<number> {
    try {
      // Get last 7 days of metrics
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      
      const metrics = await this.modelMetricsRepository.find({
        where: {
          date: MoreThan(sevenDaysAgo),
        },
        order: { date: 'DESC' },
        take: 10,
      });

      if (metrics.length === 0) {
        // Use default based on model training accuracy
        return 0.50; // Default for new models
      }

      // Calculate weighted average (more recent = more weight)
      let weightedSum = 0;
      let weightSum = 0;
      
      metrics.forEach((m, index) => {
        const weight = metrics.length - index; // Higher weight for recent
        weightedSum += (m.accuracy || 0.5) * weight;
        weightSum += weight;
      });

      return weightedSum / weightSum;
    } catch (error) {
      this.logger.warn(`Could not get historical accuracy: ${error.message}`);
      return 0.50;
    }
  }

  /**
   * Assess contextual factors
   */
  private assessContextualFactors(features: MatchFeatures): number {
    let score = 1.0;

    // Reduce confidence for unusual conditions
    if (features.weatherImpact > 0.5) {
      score *= 0.9; // Bad weather adds uncertainty
    }

    // Check rest days
    if (features.daysSinceLastMatchHome > 10) {
      score *= 0.95; // Unusual rest period
    }
    if (features.daysSinceLastMatchAway > 10) {
      score *= 0.95;
    }

    // Manager tenure
    if (features.homeManagerTenure < 30) {
      score *= 0.9; // New manager
    }
    if (features.awayManagerTenure < 30) {
      score *= 0.9;
    }

    return Math.max(score, 0.4);
  }

  /**
   * Calculate accuracy for a batch of predictions
   */
  async calculateBatchAccuracy(predictions: Prediction[]): Promise<number> {
    if (predictions.length === 0) return 0;

    const correctCount = predictions.filter(p => p.isCorrect).length;
    return correctCount / predictions.length;
  }

  /**
   * Get confidence distribution statistics
   */
  async getConfidenceStats(days: number = 30): Promise<{
    avgConfidence: number;
    highConfidenceCount: number;
    lowConfidenceCount: number;
    distribution: { low: number; medium: number; high: number };
  }> {
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const predictions = await this.predictionRepository.find({
      where: {
        createdAt: MoreThan(startDate),
      },
    });

    if (predictions.length === 0) {
      return {
        avgConfidence: 0,
        highConfidenceCount: 0,
        lowConfidenceCount: 0,
        distribution: { low: 0, medium: 0, high: 0 },
      };
    }

    const confidences = predictions.map(p => Number(p.confidence));
    const avgConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;

    const highConfidenceCount = confidences.filter(c => c >= 0.7).length;
    const lowConfidenceCount = confidences.filter(c => c < 0.5).length;

    return {
      avgConfidence: parseFloat(avgConfidence.toFixed(4)),
      highConfidenceCount,
      lowConfidenceCount,
      distribution: {
        low: confidences.filter(c => c < 0.5).length,
        medium: confidences.filter(c => c >= 0.5 && c < 0.7).length,
        high: confidences.filter(c => c >= 0.7).length,
      },
    };
  }
}
