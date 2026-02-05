import { Controller, Get, Post, Param, Query, Body, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { PredictionService } from '../services/prediction.service';
import { MLInferenceService } from '../services/ml-inference.service';
import { ModelMonitoringService } from '../../ml-monitoring/services/model-monitoring.service';
import { ConfidenceScoringService } from '../services/confidence-scoring.service';

@ApiTags('Predictions')
@Controller('predictions')
export class PredictionController {
  private readonly logger = new Logger(PredictionController.name);

  constructor(
    private readonly predictionService: PredictionService,
    private readonly mlInferenceService: MLInferenceService,
    private readonly modelMonitoringService: ModelMonitoringService,
    private readonly confidenceScoringService: ConfidenceScoringService,
  ) {}

  /**
   * Get prediction for a specific fixture
   */
  @Get('fixture/:id')
  @ApiOperation({
    summary: 'Get prediction for a fixture',
    description: 'Returns win/draw/loss probabilities for a specific fixture',
  })
  @ApiResponse({ status: 200, description: 'Prediction result' })
  async predictMatch(@Param('id') id: string) {
    this.logger.log(`Getting prediction for fixture ${id}`);

    const start = Date.now();
    let result = await this.predictionService.getPrediction(id);

    // Generate if not exists
    if (!result) {
      result = await this.predictionService.generatePrediction(id);
    }

    const duration = Date.now() - start;
    this.logger.log(`Prediction completed in ${duration}ms`);

    return {
      success: true,
      data: result,
      meta: {
        computeTimeMs: duration,
      },
    };
  }

  /**
   * Get today's predictions
   */
  @Get('today')
  @ApiOperation({
    summary: 'Get today predictions',
    description: 'Returns predictions for all fixtures scheduled for today',
  })
  @ApiResponse({ status: 200, description: 'List of today predictions' })
  async getTodayPredictions() {
    this.logger.log('Getting today predictions');
    const start = Date.now();

    const predictions = await this.predictionService.getTodayPredictions();
    const duration = Date.now() - start;

    return {
      success: true,
      data: predictions,
      meta: {
        count: predictions.length,
        computeTimeMs: duration,
      },
    };
  }

  /**
   * Get upcoming predictions
   */
  @Get('upcoming')
  @ApiOperation({
    summary: 'Get upcoming predictions',
    description: 'Returns predictions for fixtures in the next N days (default: 7)',
  })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of upcoming predictions' })
  async getUpcomingPredictions(@Query('days') days?: string) {
    const daysCount = days ? parseInt(days, 10) : 7;
    this.logger.log(`Getting predictions for next ${daysCount} days`);
    const start = Date.now();

    const predictions = await this.predictionService.getUpcomingPredictions(daysCount);
    const duration = Date.now() - start;

    return {
      success: true,
      data: predictions,
      meta: {
        days: daysCount,
        count: predictions.length,
        computeTimeMs: duration,
      },
    };
  }

  /**
   * Get predictions by league
   */
  @Get('league/:code')
  @ApiOperation({
    summary: 'Get predictions by league',
    description: 'Returns predictions for fixtures in a specific league',
  })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of league predictions' })
  async getPredictionsByLeague(
    @Param('code') code: string,
    @Query('days') days?: string,
  ) {
    const daysCount = days ? parseInt(days, 10) : 7;
    this.logger.log(`Getting predictions for ${code} league`);
    const start = Date.now();

    const predictions = await this.predictionService.getPredictionsByLeague(code, daysCount);
    const duration = Date.now() - start;

    return {
      success: true,
      data: predictions,
      meta: {
        league: code,
        days: daysCount,
        count: predictions.length,
        computeTimeMs: duration,
      },
    };
  }

  /**
   * Get model accuracy statistics
   */
  @Get('accuracy')
  @ApiOperation({
    summary: 'Get model accuracy stats',
    description: 'Returns model accuracy statistics and performance metrics',
  })
  @ApiResponse({ status: 200, description: 'Accuracy statistics' })
  async getAccuracyStats() {
    this.logger.log('Getting accuracy statistics');

    const stats = await this.predictionService.getAccuracyStats();
    const driftStatus = await this.modelMonitoringService.checkModelDrift();
    const health = await this.modelMonitoringService.getModelHealth();

    return {
      success: true,
      data: {
        ...stats,
        driftStatus,
        modelHealth: health,
      },
    };
  }

  /**
   * Get model health status
   */
  @Get('health')
  @ApiOperation({
    summary: 'Get model health',
    description: 'Returns overall model health status including drift detection',
  })
  @ApiResponse({ status: 200, description: 'Model health status' })
  async getModelHealth() {
    const health = await this.modelMonitoringService.getModelHealth();

    return {
      success: true,
      data: health,
    };
  }

  /**
   * Get model status (loaded models, paths, etc.)
   */
  @Get('models')
  @ApiOperation({
    summary: 'Get ML model status',
    description: 'Returns information about loaded ML models',
  })
  @ApiResponse({ status: 200, description: 'Model status' })
  async getModelStatus() {
    const status = this.mlInferenceService.getModelStatus();
    const health = await this.modelMonitoringService.getModelHealth();

    return {
      success: true,
      data: {
        ...status,
        ensembleWeights: {
          xgboost: 0.5,
          logistic: 0.25,
          random_forest: 0.25,
        },
        health,
      },
    };
  }

  /**
   * Get accuracy history for charting
   */
  @Get('history')
  @ApiOperation({
    summary: 'Get accuracy history',
    description: 'Returns daily accuracy history for charting',
  })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Accuracy history' })
  async getAccuracyHistory(@Query('days') days?: string) {
    const daysCount = days ? parseInt(days, 10) : 30;
    this.logger.log(`Getting accuracy history for ${daysCount} days`);

    const history = await this.modelMonitoringService.getAccuracyHistory('ensemble_v1', daysCount);

    return {
      success: true,
      data: history,
      meta: {
        days: daysCount,
      },
    };
  }

  /**
   * Get confidence distribution stats
   */
  @Get('confidence')
  @ApiOperation({
    summary: 'Get confidence distribution',
    description: 'Returns statistics about prediction confidence levels',
  })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Confidence statistics' })
  async getConfidenceStats(@Query('days') days?: string) {
    const daysCount = days ? parseInt(days, 10) : 30;
    this.logger.log(`Getting confidence stats for ${daysCount} days`);

    const stats = await this.confidenceScoringService.getConfidenceStats(daysCount);

    return {
      success: true,
      data: stats,
      meta: {
        days: daysCount,
      },
    };
  }

  /**
   * Generate prediction on demand
   */
  @Post('generate/:fixtureId')
  @ApiOperation({
    summary: 'Generate prediction on demand',
    description: 'Forces generation of a prediction for a specific fixture',
  })
  @ApiResponse({ status: 200, description: 'Generated prediction' })
  async generatePrediction(@Param('fixtureId') fixtureId: string) {
    this.logger.log(`Generating prediction on demand for fixture ${fixtureId}`);

    try {
      const prediction = await this.predictionService.generatePrediction(fixtureId);
      return {
        success: true,
        data: prediction,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: `Failed to generate prediction: ${error.message}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Mark actual result for a fixture
   */
  @Post('result/:fixtureId')
  @ApiOperation({
    summary: 'Mark actual result',
    description: 'Records the actual match result for accuracy tracking',
  })
  @ApiResponse({ status: 200, description: 'Result recorded' })
  async markResult(
    @Param('fixtureId') fixtureId: string,
    @Body() body: { outcome: 'HOME' | 'DRAW' | 'AWAY' },
  ) {
    this.logger.log(`Marking result for fixture ${fixtureId}: ${body.outcome}`);

    try {
      await this.predictionService.markResult(fixtureId, body.outcome);
      return {
        success: true,
        message: `Result recorded for fixture ${fixtureId}`,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          message: `Failed to mark result: ${error.message}`,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}

