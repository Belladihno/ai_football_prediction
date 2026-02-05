import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PredictionService } from './services/prediction.service';
import { MLInferenceService } from './services/ml-inference.service';
import { ConfidenceScoringService } from './services/confidence-scoring.service';
import { FeatureEngineeringService } from './services/feature-engineering.service';
import { PredictionController } from './controllers/prediction.controller';
import { Prediction } from './entities/prediction.entity';
import { FootballModule } from '../football/football.module';
import { Fixture } from '../football/entities/fixture.entity';
import { Team } from '../football/entities/team.entity';
import { Standing } from '../football/entities/standing.entity';
import { ModelMetrics } from '../ml-monitoring/entities/model-metrics.entity';
import { ModelMonitoringService } from '../ml-monitoring/services/model-monitoring.service';
import { DataQualityModule } from '../data-quality/data-quality.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Prediction, Fixture, Team, Standing, ModelMetrics]),
    FootballModule,
    DataQualityModule,
  ],
  controllers: [PredictionController],
  providers: [
    PredictionService,
    MLInferenceService,
    ConfidenceScoringService,
    FeatureEngineeringService,
    ModelMonitoringService,
  ],
  exports: [PredictionService, MLInferenceService, ConfidenceScoringService],
})
export class PredictionsModule {}

