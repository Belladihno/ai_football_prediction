import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('model_metrics')
export class ModelMetrics {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  modelVersion: string;

  @Column({ type: 'date' })
  date: Date;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  accuracy: number;

  @Column({ type: 'decimal', precision: 5, scale: 4 })
  brierScore: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true })
  roi: number;

  @Column({ type: 'jsonb', nullable: true })
  confusionMatrix: {
    home: { predicted: number; actual: number };
    draw: { predicted: number; actual: number };
    away: { predicted: number; actual: number };
  };

  @Column({ type: 'int', default: 0 })
  totalPredictions: number;

  @Column({ type: 'int', default: 0 })
  correctPredictions: number;

  @CreateDateColumn()
  createdAt: Date;
}
