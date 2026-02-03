import {
  Controller,
  Get,
  Param,
  Query,
  Logger,
} from '@nestjs/common';
import { TeamService } from '../services/team.service';
import { Team } from '../entities/team.entity';

@Controller('teams')
export class TeamController {
  private readonly logger = new Logger(TeamController.name);

  constructor(private readonly teamService: TeamService) {}

  // Get all teams with optional filters
  @Get()
  async findAll(
    @Query('leagueId') leagueId?: string,
    @Query('limit') limit?: string,
  ): Promise<Team[]> {
    this.logger.log(`Getting teams with leagueId: ${leagueId}`);

    const options: any = {};
    if (leagueId) options.leagueId = leagueId;
    if (limit) options.limit = parseInt(limit, 10);

    return this.teamService.findAll(options);
  }

  // Get single team by ID
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Team> {
    return this.teamService.findOne(id);
  }

  // Get team form
  @Get(':id/form')
  async getForm(
    @Param('id') id: string,
    @Query('games') games?: string,
  ): Promise<{ teamId: string; form: string; gamesCount: number }> {
    const gamesCount = games ? parseInt(games, 10) : 5;
    const form = await this.teamService.getForm(id, gamesCount);

    return {
      teamId: id,
      form,
      gamesCount,
    };
  }
}
