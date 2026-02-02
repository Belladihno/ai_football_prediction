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
import type { Team } from './team.entity';
import type { League } from './league.entity';

export enum FixtureStatus {
  SCHEDULED = 'SCHEDULED',
  TIMED = 'TIMED',
  IN_PLAY = 'IN_PLAY',
  PAUSED = 'PAUSED',
  FINISHED = 'FINISHED',
  POSTPONED = 'POSTPONED',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
}

interface TeamStats {
  goals?: number;
  shots?: number;
  shotsOnTarget?: number;
  possession?: number;
  passes?: number;
  tackles?: number;
  corners?: number;
  fouls?: number;
}

@Entity('fixtures')
export class Fixture {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, type: 'int' })
  externalId: number; // ID from football-data.org

  @Column({ type: 'timestamp' })
  kickoff: Date;

  @Column({ nullable: true, type: 'int' })
  matchday: number | null;

  @Column({
    type: 'enum',
    enum: FixtureStatus,
    default: FixtureStatus.SCHEDULED,
  })
  status: FixtureStatus;

  @Column({ nullable: true, type: 'int' })
  homeGoals: number | null;

  @Column({ nullable: true, type: 'int' })
  awayGoals: number | null;

  @Column({ nullable: true, type: 'int' })
  homePenalties: number | null;

  @Column({ nullable: true, type: 'int' })
  awayPenalties: number | null;

  @Column({ nullable: true, type: 'int' })
  homeHalfTimeGoals: number | null;

  @Column({ nullable: true, type: 'int' })
  awayHalfTimeGoals: number | null;

  @Column({ nullable: true, type: 'int' })
  homeExtraTimeGoals: number | null;

  @Column({ nullable: true, type: 'int' })
  awayExtraTimeGoals: number | null;

  @Column({ nullable: true, type: 'varchar' })
  venue: string | null;

  @Column({ nullable: true, type: 'varchar' })
  referee: string | null;

  @Column({ nullable: true, type: 'jsonb' })
  homeTeamStats: TeamStats | null;

  @Column({ nullable: true, type: 'jsonb' })
  awayTeamStats: TeamStats | null;

  @Column({ nullable: true, type: 'varchar' })
  season: string | null; // e.g., "2023/2024"

  @ManyToOne('Team', (team: Team) => team.homeFixtures)
  @JoinColumn({ name: 'homeTeamId' })
  homeTeam: Team;

  @Column({ type: 'uuid' })
  homeTeamId: string;

  @ManyToOne('Team', (team: Team) => team.awayFixtures)
  @JoinColumn({ name: 'awayTeamId' })
  awayTeam: Team;

  @Column({ type: 'uuid' })
  awayTeamId: string;

  @ManyToOne('League', (league: League) => league.fixtures)
  @JoinColumn({ name: 'leagueId' })
  league: League;

  @Column({ type: 'uuid' })
  leagueId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
