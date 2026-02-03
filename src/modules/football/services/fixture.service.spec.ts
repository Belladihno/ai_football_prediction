import { Test, TestingModule } from '@nestjs/testing';
import { FixtureService } from './fixture.service';
import { FootballDataApiService } from './football-data-api.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Fixture } from '../entities/fixture.entity';
import { Repository } from 'typeorm';
import { FixtureStatus } from '../entities/fixture.entity';

describe('FixtureService', () => {
  let service: FixtureService;
  let apiService: FootballDataApiService;
  let repository: Repository<Fixture>;

  // Mock data
  const mockFixtures = [
    {
      id: 'uuid-1',
      externalId: 123,
      kickoff: new Date('2024-01-15T15:00:00Z'),
      status: FixtureStatus.SCHEDULED,
      homeGoals: null,
      awayGoals: null,
      matchday: 21,
      homeTeamId: 'uuid-1',
      awayTeamId: 'uuid-2',
      leagueId: 'uuid-league',
      season: '2023/2024',
    },
  ];

  const mockApiFixture = {
    id: 123,
    competition: { id: 1 },
    utcDate: '2024-01-15T15:00:00Z',
    matchday: 21,
    status: 'SCHEDULED',
    homeTeam: { id: 1, name: 'Home Team' },
    awayTeam: { id: 2, name: 'Away Team' },
    score: {
      winner: null,
      homeTeam: null,
      awayTeam: null,
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
    },
  };

  // Mock repository
  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  // Mock API service
  const mockApiService = {
    getMatches: jest.fn(),
    getUpcomingMatches: jest.fn(),
    getFixture: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixtureService,
        {
          provide: getRepositoryToken(Fixture),
          useValue: mockRepository,
        },
        {
          provide: FootballDataApiService,
          useValue: mockApiService,
        },
      ],
    }).compile();

    service = module.get<FixtureService>(FixtureService);
    apiService = module.get<FootballDataApiService>(FootballDataApiService);
    repository = module.get<Repository<Fixture>>(getRepositoryToken(Fixture));

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all fixtures', async () => {
      mockRepository.find.mockResolvedValue(mockFixtures);

      const result = await service.findAll({});

      expect(result).toEqual(mockFixtures);
      expect(mockRepository.find).toHaveBeenCalled();
    });

    it('should return empty array if no fixtures', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result).toEqual([]);
    });

    it('should filter by league when leagueId provided', async () => {
      mockRepository.find.mockResolvedValue([mockFixtures[0]]);

      const result = await service.findAll({ leagueId: 'uuid-league' });

      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return a single fixture by id', async () => {
      mockRepository.findOne.mockResolvedValue(mockFixtures[0]);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockFixtures[0]);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('should return null if fixture not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findOne('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('syncFixtures', () => {
    it('should sync fixtures from API', async () => {
      mockApiService.getUpcomingMatches.mockResolvedValue([mockApiFixture]);
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue({ ...mockFixtures[0], externalId: 123 });
      mockRepository.save.mockResolvedValue({ ...mockFixtures[0], externalId: 123 });

      const result = await service.syncFixtures('PL', 'uuid-league');

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(mockApiService.getUpcomingMatches).toHaveBeenCalledWith('PL');
    });

    it('should update existing fixtures', async () => {
      mockApiService.getUpcomingMatches.mockResolvedValue([mockApiFixture]);
      mockRepository.findOne.mockResolvedValue({ ...mockFixtures[0], id: 'uuid-existing' });
      mockRepository.save.mockResolvedValue(mockFixtures[0]);

      const result = await service.syncFixtures('PL', 'uuid-league');

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
    });

    it('should handle API errors gracefully', async () => {
      mockApiService.getUpcomingMatches.mockResolvedValue([]);
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.syncFixtures('PL', 'uuid-league');

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
    });
  });
});
