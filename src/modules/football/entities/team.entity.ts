import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';

// Forward declarations to avoid circular imports
import type { League } from './league.entity';
import type { Fixture } from './fixture.entity';

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, type: 'int' })
  externalId: number; // ID from football-data.org

  @Column({ type: 'varchar' })
  name: string;

  @Column({ nullable: true, type: 'varchar' })
  shortName: string;

  @Column({ nullable: true, type: 'varchar' })
  tla: string; // Three letter abbreviation

  @Column({ nullable: true, type: 'varchar' })
  crestUrl: string;

  @Column({ nullable: true, type: 'varchar' })
  stadium: string;

  @Column({ nullable: true, type: 'int' })
  capacity: number;

  @Column({ nullable: true, type: 'varchar' })
  address: string;

  @Column({ nullable: true, type: 'varchar' })
  website: string;

  @Column({ nullable: true, type: 'int' })
  founded: number;

  @Column({ nullable: true, type: 'varchar' })
  clubColors: string;

  @Column({ nullable: true, type: 'varchar' })
  venue: string; // Home stadium

  @Column({ nullable: true, type: 'decimal', precision: 6, scale: 2 })
  latitude: number;

  @Column({ nullable: true, type: 'decimal', precision: 6, scale: 2 })
  longitude: number;

  // Form data - cached for quick access
  @Column({ nullable: true, type: 'varchar' })
  lastFiveResults: string; // e.g., "WDLWW"

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  pointsPerGame: number;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  goalsScoredPerGame: number;

  @Column({ type: 'decimal', precision: 3, scale: 2, default: 0 })
  goalsConcededPerGame: number;

  @Column({ type: 'int', default: 0 })
  goalDifference: number;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'int', default: 0 })
  gamesPlayed: number;

  @Column({ type: 'int', default: 0 })
  gamesWon: number;

  @Column({ type: 'int', default: 0 })
  gamesDrawn: number;

  @Column({ type: 'int', default: 0 })
  gamesLost: number;

  @Column({ type: 'int', default: 0 })
  points: number;

  @ManyToOne('League', (league: League) => league.teams)
  @JoinColumn({ name: 'leagueId' })
  league: League;

  @Column({ type: 'uuid', nullable: true })
  leagueId: string;

  @OneToMany('Fixture', (fixture: Fixture) => fixture.homeTeam)
  homeFixtures: Fixture[];

  @OneToMany('Fixture', (fixture: Fixture) => fixture.awayTeam)
  awayFixtures: Fixture[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

