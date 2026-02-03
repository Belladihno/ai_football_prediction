import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface InjuryData {
  playerId: number;
  playerName: string;
  teamId: number;
  teamName: string;
  status: 'OUT' | 'DOUBTFUL' | 'RECOVERING';
  injuryType: string;
  expectedReturn: Date | null;
  impact: number; // 0-1 scale
}

@Injectable()
export class InjuryService {
  private readonly logger = new Logger(InjuryService.name);
  private client: AxiosInstance;
  private readonly fplApiKey: string;

  constructor(private configService: ConfigService) {
    // Fantasy Premier League doesn't require API key for public data
    this.client = axios.create({
      baseURL: 'https://fantasy.premierleague.com/api',
      timeout: 5000,
    });
  }

  /**
   * Get injury data for Premier League from FPL API
   */
  async getPremierLeagueInjuries(): Promise<InjuryData[]> {
    try {
      const response = await this.client.get('/bootstrap-static/');
      const players = response.data.elements || [];

      const injuries: InjuryData[] = [];

      for (const player of players) {
        if (player.status !== 'a') { // 'a' = available
          const injury: InjuryData = {
            playerId: player.id,
            playerName: player.web_name,
            teamId: player.team,
            teamName: '', // Will need to map from teams API
            status: this.mapFplStatus(player.status),
            injuryType: player.news || 'Unknown',
            expectedReturn: player.chance_of_playing_next_round > 0 
              ? this.estimateReturnDate(player.chance_of_playing_next_round) 
              : null,
            impact: this.calculateImpact(player),
          };
          injuries.push(injury);
        }
      }

      return injuries;
    } catch (error) {
      this.logger.error(`Failed to fetch Premier League injuries: ${error.message}`);
      return [];
    }
  }

  /**
   * Get injuries for a specific team
   */
  async getTeamInjuries(teamId: string): Promise<InjuryData[]> {
    // This would need team-specific data sources
    // For now, return empty array as we need team external IDs
    this.logger.warn(`Team-specific injury lookup not yet implemented for team ${teamId}`);
    return [];
  }

  /**
   * Calculate injury impact on team performance (0-1 scale)
   */
  private calculateImpact(player: any): number {
    let impact = 0;

    // Key players have higher impact
    if (player.element_type === 1) { // Goalkeeper
      impact += 0.3;
    } else if (player.element_type === 2) { // Defender
      impact += 0.2;
    } else if (player.element_type === 3) { // Midfielder
      impact += 0.25;
    } else if (player.element_type === 4) { // Forward
      impact += 0.3;
    }

    // Players with high expected points have higher impact
    if (player.ep_next > 5) {
      impact += 0.2;
    }

    // Chance of playing affects impact
    if (player.chance_of_playing_this_round === null) {
      impact *= 0.7; // Doubtful
    } else if (player.chance_of_playing_this_round < 50) {
      impact *= 0.5;
    }

    return Math.min(impact, 1);
  }

  /**
   * Map FPL status code to our status
   */
  private mapFplStatus(status: string): 'OUT' | 'DOUBTFUL' | 'RECOVERING' {
    switch (status) {
      case 'i': return 'OUT';
      case 'u': return 'DOUBTFUL';
      case 'n': return 'RECOVERING';
      default: return 'DOUBTFUL';
    }
  }

  /**
   * Estimate return date based on chance percentage
   */
  private estimateReturnDate(chance: number | null): Date {
    const days = chance && chance > 50 ? 7 : 14;
    const returnDate = new Date();
    returnDate.setDate(returnDate.getDate() + days);
    return returnDate;
  }

  /**
   * Get total injury impact for a team
   */
  getTeamInjuryImpact(injuries: InjuryData[]): number {
    if (injuries.length === 0) return 0;

    const totalImpact = injuries.reduce((sum, injury) => sum + injury.impact, 0);
    return Math.min(totalImpact / 5, 1); // Cap at 5 injuries worth of impact
  }
}
