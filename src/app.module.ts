import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { FootballModule } from './modules/football/football.module';
import { SyncModule } from './modules/sync/sync.module';
import { QueueModule } from './modules/queue/queue.module';
import { PredictionsModule } from './modules/predictions/predictions.module';
import { League } from './modules/football/entities/league.entity';
import { Team } from './modules/football/entities/team.entity';
import { Fixture } from './modules/football/entities/fixture.entity';
import { Standing } from './modules/football/entities/standing.entity';
import { Prediction } from './modules/predictions/entities/prediction.entity';
import { ModelMetrics } from './modules/ml-monitoring/entities/model-metrics.entity';
import { Injury } from './modules/football/entities/injury.entity';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Bull Queue (Redis-based background jobs) - Global module
    QueueModule,

    // TypeORM PostgreSQL
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.name'),
        entities: [League, Team, Fixture, Standing, Prediction, ModelMetrics, Injury],
        synchronize: configService.get<boolean>('database.synchronize'),
        logging: configService.get<boolean>('database.logging'),
      }),
    }),

    // Feature modules
    FootballModule,
    SyncModule,
    PredictionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
