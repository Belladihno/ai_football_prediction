import {
  Controller,
  Get,
  Param,
  Query,
  Post,
  Body,
  Logger,
} from '@nestjs/common';
import { FixtureService } from '../services/fixture.service';
import { Fixture, FixtureStatus } from '../entities/fixture.entity';

interface FixtureQueryDto {
  leagueId?: string;
  fromDate?: string;
  toDate?: string;
  status?: FixtureStatus;
  limit?: number;
}

@Controller('api/fixtures')
export class FixtureController {
  private readonly logger = new Logger(FixtureController.name);

  constructor(private readonly fixtureService: FixtureService) {}

  // Get all fixtures with filters
  @Get()
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
  async getToday(): Promise<Fixture[]> {
    return this.fixtureService.getTodayFixtures();
  }

  // Get upcoming fixtures (next 7 days by default)
  @Get('upcoming')
  async getUpcoming(@Query('days') days?: string): Promise<Fixture[]> {
    const daysCount = days ? parseInt(days, 10) : 7;
    return this.fixtureService.getUpcomingFixtures(daysCount);
  }

  // Get single fixture by ID
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Fixture> {
    return this.fixtureService.findOne(id);
  }
}
