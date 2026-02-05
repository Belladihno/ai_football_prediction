import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Body,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { FixtureService } from '../services/fixture.service';
import { Fixture, FixtureStatus } from '../entities/fixture.entity';

interface FixtureQueryDto {
  leagueId?: string;
  fromDate?: string;
  toDate?: string;
  status?: FixtureStatus;
  limit?: number;
}

@ApiTags('Fixtures')
@Controller('fixtures')
export class FixtureController {
  private readonly logger = new Logger(FixtureController.name);

  constructor(private readonly fixtureService: FixtureService) {}

  // Get all fixtures with filters
  @Get()
  @ApiOperation({ summary: 'Get all fixtures', description: 'Returns fixtures with optional filters' })
  @ApiQuery({ name: 'leagueId', required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  @ApiQuery({ name: 'status', required: false, enum: FixtureStatus })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of fixtures' })
  async findAll(@Query() query: FixtureQueryDto): Promise<Fixture[]> {
    this.logger.log(`Getting fixtures with query: ${JSON.stringify(query)}`);

    const options: any = {};
    if (query.leagueId) options.leagueId = query.leagueId;
    if (query.fromDate) options.fromDate = new Date(query.fromDate);
    if (query.toDate) options.toDate = new Date(query.toDate);
    if (query.status) options.status = query.status;
    if (query.limit) options.limit = query.limit;

    return this.fixtureService.findAll(options);
  }

  // Get today's fixtures
  @Get('today')
  @ApiOperation({ summary: 'Get today fixtures', description: 'Returns all fixtures scheduled for today' })
  @ApiResponse({ status: 200, description: 'List of today fixtures' })
  async getToday(): Promise<Fixture[]> {
    return this.fixtureService.getTodayFixtures();
  }

  // Get upcoming fixtures (next 7 days by default)
  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming fixtures', description: 'Returns fixtures scheduled for the next N days' })
  @ApiQuery({ name: 'days', required: false, description: 'Number of days to look ahead' })
  @ApiResponse({ status: 200, description: 'List of upcoming fixtures' })
  async getUpcoming(@Query('days') days?: string): Promise<Fixture[]> {
    const daysCount = days ? parseInt(days, 10) : 7;
    return this.fixtureService.getUpcomingFixtures(daysCount);
  }

  // Get single fixture by ID
  @Get(':id')
  @ApiOperation({ summary: 'Get fixture by ID', description: 'Returns detailed information for a specific fixture' })
  @ApiResponse({ status: 200, description: 'Fixture details' })
  async findOne(@Param('id') id: string): Promise<Fixture> {
    return this.fixtureService.findOne(id);
  }
}
