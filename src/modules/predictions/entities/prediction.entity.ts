import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { Fixture } from '../../football/entities/fixture.entity';

export enum PredictionOutcome {
  HOME = 'HOME',
  DRAW = 'DRAW',
  AWAY = 'AWAY',
}

@Entity('predictions')
export class Prediction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('Fixture', (fixture: Fixture) => fixture)
  @JoinColumn({ name: 'fixtureId' })
  fixture: Fixture;

  @Column({ type: 'uuid' })
  fixtureId: string;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  homeWinProb: number;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  drawProb: number;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  awayWinProb: number;

  @Column({
    type: 'enum',
    enum: PredictionOutcome,
  })
  predictedOutcome: PredictionOutcome;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  confidence: number;

  @Column({ type: 'jsonb', nullable: true })
  confidenceBreakdown: {
    dataQuality: number;
    modelCertainty: number;
    historicalAccuracy: number;
    contextualFactors: number;
  };

  @Column({ type: 'jsonb', nullable: true })
  features: Record<string, any>;

  @Column({ type: 'varchar' })
  modelVersion: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  predictedHomeGoals: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  predictedAwayGoals: number;

  @Column({ nullable: true })
  actualOutcome: string;

  @Column({ type: 'boolean', default: false })
  isCorrect: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
