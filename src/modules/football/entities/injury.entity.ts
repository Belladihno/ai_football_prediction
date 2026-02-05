import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { Team } from './team.entity';

@Entity('injuries')
export class Injury {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', default: 'FPL' })
  source: 'FPL' | 'MANUAL';

  @Column({ type: 'varchar', nullable: true })
  leagueCode: string | null;

  @ManyToOne('Team', (team: Team) => team)
  @JoinColumn({ name: 'teamId' })
  team: Team;

  @Column({ type: 'uuid', nullable: true })
  teamId: string | null;

  @Column({ type: 'int', nullable: true })
  teamExternalId: number | null;

  @Column({ type: 'varchar', nullable: true })
  teamName: string | null;

  @Column({ type: 'int', nullable: true })
  playerId: number | null;

  @Column({ type: 'varchar' })
  playerName: string;

  @Column({ type: 'varchar', nullable: true })
  position: 'GK' | 'DEF' | 'MID' | 'FWD' | null;

  @Column({ type: 'varchar' })
  status: 'OUT' | 'DOUBTFUL' | 'RECOVERING';

  @Column({ type: 'varchar', nullable: true })
  injuryType: string | null;

  @Column({ type: 'date', nullable: true })
  expectedReturn: Date | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  impactScore: number; // 0-10 scale

  @Column({ type: 'timestamp' })
  lastUpdated: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
