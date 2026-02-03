import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';

// Forward declarations to avoid circular imports
import type { League } from './league.entity';
import type { Team } from './team.entity';

@Entity('standings')
export class Standing {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne('League', (league: League) => league.standings)
  @JoinColumn({ name: 'leagueId' })
  league: League;

  @Column({ type: 'uuid' })
  leagueId: string;

  @ManyToOne('Team')
  @JoinColumn({ name: 'teamId' })
  team: Team;

  @Column({ type: 'uuid' })
  teamId: string;

  @Column({ type: 'int' })
  position: number;

  @Column({ type: 'int', default: 0 })
  playedGames: number;

  @Column({ type: 'int', default: 0 })
  won: number;

  @Column({ type: 'int', default: 0 })
  drawn: number;

  @Column({ type: 'int', default: 0 })
  lost: number;

  @Column({ type: 'int', default: 0 })
  goalsFor: number;

  @Column({ type: 'int', default: 0 })
  goalsAgainst: number;

  @Column({ type: 'int', default: 0 })
  goalDifference: number;

  @Column({ type: 'int', default: 0 })
  points: number;

  @Column({ type: 'int', default: 0 })
  gamesPlayed: number;

  @Column({ type: 'varchar', nullable: true })
  form: string; // e.g., "WDLWW"

  @Column({ type: 'varchar', nullable: true })
  status: string; // e.g., "same", "promote", "relegate"

  @Column({ type: 'varchar', nullable: true })
  season: string; // e.g., "2023/2024"

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
