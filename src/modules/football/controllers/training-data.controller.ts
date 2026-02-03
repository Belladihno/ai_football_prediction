import { Controller, Post, Get, Logger } from '@nestjs/common';
import { HistoricalDataService } from '../services/historical-data.service';

/**
 * Training Data Controller
 * 
 * Provides endpoints for managing ML training data:
 * - POST /api/training-data/collect - Collect historical match data
 * - GET /api/training-data/stats - Get training data statistics
 * - GET /api/training-data/check - Check if enough data for training
 */
@Controller('training-data')
export class TrainingDataController {
  private readonly logger = new Logger(TrainingDataController.name);

  constructor(private readonly historicalDataService: HistoricalDataService) {}

  /**
   * Collect all historical data for ML training
   * This triggers data collection from football-data.org API
   */
  @Post('collect')
  async collectHistoricalData(): Promise<{
    success: boolean;
    message: string;
    data?: {
      seasons: number;
      leagues: number;
      matches: number;
    };
    error?: string;
  }> {
    this.logger.log('Received request to collect historical data');

    try {
      const result = await this.historicalDataService.collectAllHistoricalData();
      
      return {
        success: true,
        message: `Collected data from ${result.seasons} seasons, ${result.leagues} leagues, ${result.matches} matches`,
        data: result,
      };
    } catch (error) {
      this.logger.error(`Failed to collect historical data: ${error.message}`);
      return {
        success: false,
        message: 'Failed to collect historical data',
        error: error.message,
      };
    }
  }

  /**
   * Get statistics about available training data
   */
  @Get('stats')
  async getTrainingDataStats(): Promise<{
    success: boolean;
    data?: {
      totalMatches: number;
      finishedMatches: number;
      matchesByLeague: Record<string, number>;
      dateRange: { oldest: Date | null; newest: Date | null };
    };
    error?: string;
  }> {
    this.logger.log('Getting training data stats');

    try {
      const stats = await this.historicalDataService.getTrainingDataStats();
      
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      this.logger.error(`Failed to get training data stats: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if we have enough data for ML training
   */
  @Get('check')
  async checkEnoughData(): Promise<{
    success: boolean;
    data?: {
      hasEnough: boolean;
      finishedMatches: number;
      minRequired: number;
    };
    error?: string;
  }> {
    this.logger.log('Checking if enough data for training');

    try {
      const finishedMatches = await this.historicalDataService.getTrainingDataStats();
      const minRequired = 1000;
      const hasEnough = finishedMatches.finishedMatches >= minRequired;
      
      return {
        success: true,
        data: {
          hasEnough,
          finishedMatches: finishedMatches.finishedMatches,
          minRequired,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to check training data: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
