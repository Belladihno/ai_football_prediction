import {
  Controller,
  Get,
  Param,
  Query,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { TeamService } from '../services/team.service';
import { Team } from '../entities/team.entity';

@ApiTags('Teams')
@Controller('teams')
export class TeamController {
  private readonly logger = new Logger(TeamController.name);

  constructor(private readonly teamService: TeamService) {}

  // Get all teams with optional filters
  @Get()
  @ApiOperation({ summary: 'Get all teams', description: 'Returns teams with optional filters by league' })
  @ApiQuery({ name: 'leagueId', required: false, description: 'Filter by league ID' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Maximum number of teams to return' })
  @ApiResponse({ status: 200, description: 'List of teams' })
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
  @ApiOperation({ summary: 'Get team by ID', description: 'Returns detailed information for a specific team' })
  @ApiResponse({ status: 200, description: 'Team details' })
  async findOne(@Param('id') id: string): Promise<Team> {
    return this.teamService.findOne(id);
  }

  // Get team form
  @Get(':id/form')
  @ApiOperation({ summary: 'Get team form', description: 'Returns the recent match results (W/D/L) for a team' })
  @ApiQuery({ name: 'games', required: false, type: Number, description: 'Number of games to analyze (default: 5)' })
  @ApiResponse({ status: 200, description: 'Team form results' })
  async getForm(
    @Param('id') id: string,
    @Query('games') games?: string,
  ): Promise<{ teamId: string; form: string; gamesCount: number }> {
    const gamesCount = games ? parseInt(games, 10) : 5;
    const formResults = await this.teamService.getForm(id, gamesCount);

    return {
      teamId: id,
      form: formResults.join(''),
      gamesCount,
    };
  }
}
