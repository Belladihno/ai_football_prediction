import { Test, TestingModule } from '@nestjs/testing';
import { FixtureService } from './fixture.service';
import { FootballDataOrgService } from './football-data-org.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Fixture } from '../entities/fixture.entity';
import { Repository } from 'typeorm';
import { FixtureStatus } from '../entities/fixture.entity';
import { TeamService } from './team.service';

describe('FixtureService', () => {
  let service: FixtureService;
  let apiService: FootballDataOrgService;
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
      fullTime: { home: null, away: null },
      halfTime: { home: null, away: null },
      regularTime: { home: null, away: null },
      extraTime: { home: null, away: null },
      penalties: { home: null, away: null },
      duration: 'REGULAR',
    },
  };

  // Mock repository
  const mockRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  // Mock API service
  const mockApiService = {
    getMatches: jest.fn(),
    getMatch: jest.fn(),
  };

  const mockTeamService = {
    findOrCreateTeam: jest.fn(),
  };

  beforeEach(async () => {
    const mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixtureService,
        {
          provide: getRepositoryToken(Fixture),
          useValue: mockRepository,
        },
        {
          provide: FootballDataOrgService,
          useValue: mockApiService,
        },
        {
          provide: TeamService,
          useValue: mockTeamService,
        },
      ],
    }).compile();

    service = module.get<FixtureService>(FixtureService);
    apiService = module.get<FootballDataOrgService>(FootballDataOrgService);
    repository = module.get<Repository<Fixture>>(getRepositoryToken(Fixture));

    // Reset all mocks before each test
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all fixtures', async () => {
      const qb = mockRepository.createQueryBuilder();
      qb.getMany.mockResolvedValue(mockFixtures);

      const result = await service.findAll({});

      expect(result).toEqual(mockFixtures);
      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('fixture');
    });

    it('should return empty array if no fixtures', async () => {
      const qb = mockRepository.createQueryBuilder();
      qb.getMany.mockResolvedValue([]);

      const result = await service.findAll({});

      expect(result).toEqual([]);
    });

    it('should filter by league when leagueId provided', async () => {
      const qb = mockRepository.createQueryBuilder();
      qb.getMany.mockResolvedValue([mockFixtures[0]]);

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
        relations: ['homeTeam', 'awayTeam', 'league'],
      });
    });

    it('should throw if fixture not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow();
    });
  });

  // Note: syncFixtures/syncAllFixtures are integration-ish tests and depend on TeamService + DB behavior.
});
