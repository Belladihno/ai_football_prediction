import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';

// Forward declarations to avoid circular imports
import type { Team } from './team.entity';
import type { Fixture } from './fixture.entity';
import type { Standing } from './standing.entity';

@Entity('leagues')
export class League {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, type: 'varchar' })
  code: string; // PL, PD, BL1, SA, FL1

  @Column({ type: 'varchar' })
  name: string;

  @Column({ nullable: true, type: 'varchar' })
  country: string;

  @Column({ nullable: true, type: 'varchar' })
  flagUrl: string;

  @Column({ nullable: true, type: 'varchar' })
  emblemUrl: string;

  @Column({ type: 'int', default: 38 })
  numberOfMatchdays: number;

  @Column({ type: 'int', default: 34 })
  numberOfTeams: number;

  @Column({ type: 'int', default: 4 })
  numberOfPromoted: number;

  @OneToMany('Team', (team: Team) => team.league)
  teams: Team[];

  @OneToMany('Fixture', (fixture: Fixture) => fixture.league)
  fixtures: Fixture[];

  @OneToMany('Standing', (standing: Standing) => standing.league)
  standings: Standing[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
