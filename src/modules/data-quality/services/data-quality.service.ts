import { Injectable, Logger } from '@nestjs/common';

export interface ValidationResult {
  isValid: boolean;
  confidence: number;
  issues: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface MatchFeatures {
  homeTeamId: string;
  awayTeamId: string;
  leagueCode: string;
  homeForm?: {
    gamesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
  };
  awayForm?: {
    gamesPlayed: number;
    wins: number;
    draws: number;
    losses: number;
  };
  homeGoalsPerGame?: number;
  awayGoalsPerGame?: number;
  h2hData?: {
    matchesPlayed: number;
    homeWins: number;
    awayWins: number;
    draws: number;
  };
  injuryData?: { homeInjuries: number; awayInjuries: number };
  lastUpdated?: Date;
}

@Injectable()
export class DataQualityService {
  private readonly logger = new Logger(DataQualityService.name);

  /**
   * Validate features before making a prediction
   */
  validateFeatures(features: MatchFeatures): ValidationResult {
    const issues: string[] = [];
    let confidence = 1.0;

    // Check form data availability
    if (!features.homeForm || features.homeForm.gamesPlayed < 3) {
      issues.push('Insufficient home team form data');
      confidence *= 0.85;
    }

    if (!features.awayForm || features.awayForm.gamesPlayed < 3) {
      issues.push('Insufficient away team form data');
      confidence *= 0.85;
    }

    // Check goals data
    if (!features.homeGoalsPerGame || features.homeGoalsPerGame > 5) {
      issues.push('Unrealistic home goals per game - possible data error');
      confidence *= 0.7;
    }

    if (!features.awayGoalsPerGame || features.awayGoalsPerGame > 5) {
      issues.push('Unrealistic away goals per game - possible data error');
      confidence *= 0.7;
    }

    // Check H2H data
    if (!features.h2hData || features.h2hData.matchesPlayed < 2) {
      issues.push('Limited head-to-head history');
      confidence *= 0.9;
    }

    // Check data freshness
    if (features.lastUpdated) {
      const daysSinceUpdate =
        (Date.now() - features.lastUpdated.getTime()) / (24 * 60 * 60 * 1000);
      if (daysSinceUpdate > 2) {
        issues.push(`Stale data - ${daysSinceUpdate.toFixed(1)} days old`);
        confidence *= 0.9;
      }
    }

    // Determine severity
    let severity: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    if (confidence < 0.5) {
      severity = 'HIGH';
    } else if (confidence < 0.7) {
      severity = 'MEDIUM';
    }

    return {
      isValid: confidence >= 0.4, // Minimum threshold
      confidence: Math.max(confidence, 0.3),
      issues,
      severity,
    };
  }

  /**
   * Clean and normalize features
   */
  cleanFeatures(features: MatchFeatures): MatchFeatures {
    // Cap outliers
    if (features.homeGoalsPerGame && features.homeGoalsPerGame > 4) {
      features.homeGoalsPerGame = 4;
    }
    if (features.awayGoalsPerGame && features.awayGoalsPerGame > 4) {
      features.awayGoalsPerGame = 4;
    }

    // Fill missing values with defaults
    if (!features.homeForm) {
      features.homeForm = { gamesPlayed: 0, wins: 0, draws: 0, losses: 0 };
    }
    if (!features.awayForm) {
      features.awayForm = { gamesPlayed: 0, wins: 0, draws: 0, losses: 0 };
    }
    if (!features.h2hData) {
      features.h2hData = {
        matchesPlayed: 0,
        homeWins: 0,
        awayWins: 0,
        draws: 0,
      };
    }

    return features;
  }

  /**
   * Calculate data completeness score (0-1)
   */
  calculateCompleteness(features: MatchFeatures): number {
    let score = 0;
    let maxScore = 0;

    // Form data (30%)
    maxScore += 0.3;
    const homeFormGames = features.homeForm?.gamesPlayed ?? 0;
    const awayFormGames = features.awayForm?.gamesPlayed ?? 0;
    if (homeFormGames >= 5) score += 0.15;
    if (awayFormGames >= 5) score += 0.15;

    // Goals data (20%)
    maxScore += 0.2;
    if (features.homeGoalsPerGame !== undefined) score += 0.1;
    if (features.awayGoalsPerGame !== undefined) score += 0.1;

    // H2H data (20%)
    maxScore += 0.2;
    const h2hMatches = features.h2hData?.matchesPlayed ?? 0;
    if (h2hMatches >= 5) score += 0.2;

    // Injury data (15%)
    maxScore += 0.15;
    if (features.injuryData?.homeInjuries !== undefined) score += 0.075;
    if (features.injuryData?.awayInjuries !== undefined) score += 0.075;

    // League data (15%)
    maxScore += 0.15;
    if (features.leagueCode) score += 0.15;

    return maxScore > 0 ? score / maxScore : 0;
  }
}
