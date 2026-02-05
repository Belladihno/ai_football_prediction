import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Fixture, FixtureStatus } from '../entities/fixture.entity';
import { Team } from '../entities/team.entity';
import { League } from '../entities/league.entity';
import { FootballDataOrgService, FdOMatch } from './football-data-org.service';

/**
 * Historical Data Service
 * 
 * This service collects historical match data from previous seasons
 * to populate the database with enough data for ML training.
 * 
 * Data sources:
 * - Football-Data.org API (free tier: 10 requests/minute)
 * - Supports historical data from 2020 onwards
 */

@Injectable()
export class HistoricalDataService {
    private readonly logger = new Logger(HistoricalDataService.name);

    // Supported leagues for historical data
    private readonly LEAGUES = [
        { code: 'PL', name: 'Premier League' },
        { code: 'PD', name: 'La Liga' },
        { code: 'BL1', name: 'Bundesliga' },
        { code: 'SA', name: 'Serie A' },
        { code: 'FL1', name: 'Ligue 1' },
    ];

    // Seasons to collect (format: YYYY for start year)
    private readonly SEASONS = ['2022', '2023', '2024'];

    constructor(
        @InjectRepository(Fixture)
        private fixtureRepository: Repository<Fixture>,
        @InjectRepository(Team)
        private teamRepository: Repository<Team>,
        @InjectRepository(League)
        private leagueRepository: Repository<League>,
        private footballData: FootballDataOrgService,
    ) {
    }

    /**
     * Collect all historical data for ML training
     * This should be run once to populate the database
     */
    async collectAllHistoricalData(): Promise<{
        seasons: number;
        leagues: number;
        matches: number;
    }> {
        this.logger.log('Starting historical data collection...');

        let totalMatches = 0;

        for (const league of this.LEAGUES) {
            for (const season of this.SEASONS) {
                try {
                    const matches = await this.collectSeasonData(league.code, season);
                    totalMatches += matches;

                    // Rate limiting: wait 6 seconds between requests (free tier limit)
                    await this.delay(6000);
                } catch (error) {
                    this.logger.error(`Failed to collect ${league.code} ${season}: ${error.message}`);
                }
            }
        }

        this.logger.log(`Historical data collection complete: ${totalMatches} matches`);

        return {
            seasons: this.SEASONS.length,
            leagues: this.LEAGUES.length,
            matches: totalMatches,
        };
    }

    /**
     * Collect matches for a specific league and season
     */
    async collectSeasonData(leagueCode: string, season: string): Promise<number> {
        this.logger.log(`Collecting ${leagueCode} season ${season}...`);

        try {
            const matches = await this.footballData.getMatches(leagueCode, {
                season,
                status: 'FINISHED',
            });
            this.logger.log(`Found ${matches.length} finished matches`);

            // Get or create league
            const league = await this.findOrCreateLeague(leagueCode);

            let savedCount = 0;

            for (const match of matches) {
                try {
                    const saved = await this.saveMatch(match, league);
                    if (saved) savedCount++;
                } catch (error) {
                    this.logger.warn(`Failed to save match ${match.id}: ${error.message}`);
                }
            }

            this.logger.log(`Saved ${savedCount} new matches for ${leagueCode} ${season}`);
            return savedCount;

        } catch (error) {
            this.logger.error(`API request failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Save a single match to the database
     */
    private async saveMatch(match: FdOMatch, league: League): Promise<boolean> {
        // Check if match already exists
        const existing = await this.fixtureRepository.findOne({
            where: { externalId: match.id },
        });

        if (existing) {
            return false; // Already have this match
        }

        // Get or create teams
        const homeTeam = await this.findOrCreateTeam(match.homeTeam);
        const awayTeam = await this.findOrCreateTeam(match.awayTeam);

        // Create fixture
        const fixture = this.fixtureRepository.create({
            externalId: match.id,
            kickoff: new Date(match.utcDate),
            matchday: match.matchday,
            status: FixtureStatus.FINISHED,
            homeGoals: match.score.fullTime.home,
            awayGoals: match.score.fullTime.away,
            league: league,
            homeTeam: homeTeam,
            awayTeam: awayTeam,
            leagueId: league.id,
        });

        await this.fixtureRepository.save(fixture);
        return true;
    }

    /**
     * Find or create a league
     */
    private async findOrCreateLeague(code: string): Promise<League> {
        let league = await this.leagueRepository.findOne({ where: { code } });

        if (!league) {
            const leagueInfo = this.LEAGUES.find(l => l.code === code);
            league = this.leagueRepository.create({
                code: code,
                name: leagueInfo?.name || code,
                country: this.getCountryFromCode(code),
            });
            await this.leagueRepository.save(league);
        }

        return league;
    }

    /**
     * Find or create a team
     */
    private async findOrCreateTeam(teamData: { id: number; name: string }): Promise<Team> {
        let team = await this.teamRepository.findOne({
            where: { externalId: teamData.id },
        });

        if (!team) {
            team = this.teamRepository.create({
                externalId: teamData.id,
                name: teamData.name,
                shortName: teamData.name.substring(0, 3).toUpperCase(),
            });
            await this.teamRepository.save(team);
        }

        return team;
    }

    /**
     * Get country from league code
     */
    private getCountryFromCode(code: string): string {
        const mapping: Record<string, string> = {
            'PL': 'England',
            'PD': 'Spain',
            'BL1': 'Germany',
            'SA': 'Italy',
            'FL1': 'France',
        };
        return mapping[code] || 'Unknown';
    }

    /**
     * Get statistics about available training data
     */
    async getTrainingDataStats(): Promise<{
        totalMatches: number;
        finishedMatches: number;
        matchesByLeague: Record<string, number>;
        dateRange: { oldest: Date | null; newest: Date | null };
    }> {
        const totalMatches = await this.fixtureRepository.count();
        const finishedMatches = await this.fixtureRepository.count({
            where: { status: FixtureStatus.FINISHED },
        });

        // Get matches by league
        const matchesByLeague: Record<string, number> = {};
        for (const league of this.LEAGUES) {
            const leagueEntity = await this.leagueRepository.findOne({ where: { code: league.code } });
            if (leagueEntity) {
                const count = await this.fixtureRepository.count({
                    where: { leagueId: leagueEntity.id, status: FixtureStatus.FINISHED },
                });
                matchesByLeague[league.code] = count;
            }
        }

        // Get date range
        const oldest = await this.fixtureRepository.findOne({
            where: { status: FixtureStatus.FINISHED },
            order: { kickoff: 'ASC' },
        });

        const newest = await this.fixtureRepository.findOne({
            where: { status: FixtureStatus.FINISHED },
            order: { kickoff: 'DESC' },
        });

        return {
            totalMatches,
            finishedMatches,
            matchesByLeague,
            dateRange: {
                oldest: oldest?.kickoff || null,
                newest: newest?.kickoff || null,
            },
        };
    }

    /**
     * Check if we have enough data for training
     */
    async hasEnoughDataForTraining(minMatches: number = 1000): Promise<boolean> {
        const finishedMatches = await this.fixtureRepository.count({
            where: { status: FixtureStatus.FINISHED },
        });
        return finishedMatches >= minMatches;
    }

    /**
     * Helper: delay for rate limiting
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
