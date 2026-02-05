import { Test, TestingModule } from '@nestjs/testing';
import { TeamService } from './team.service';
import { FootballDataOrgService } from './football-data-org.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Team } from '../entities/team.entity';
import { Fixture } from '../entities/fixture.entity';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

describe('TeamService', () => {
  let service: TeamService;
  let apiService: FootballDataOrgService;
  let repository: Repository<Team>;

  // Mock data
  const mockTeams = [
    {
      id: 'uuid-1',
      externalId: 1,
      name: 'Manchester United',
      shortName: 'Man United',
      tla: 'MUN',
      crestUrl: 'https://example.com/mun.png',
      stadium: 'Old Trafford',
      leagueId: 'uuid-pl',
      gamesPlayed: 20,
      gamesWon: 12,
      gamesDrawn: 5,
      gamesLost: 3,
      goalsScoredPerGame: 2.1,
      goalsConcededPerGame: 1.2,
      pointsPerGame: 2.05,
    },
    {
      id: 'uuid-2',
      externalId: 2,
      name: 'Liverpool',
      shortName: 'Liverpool',
      tla: 'LIV',
      crestUrl: 'https://example.com/liv.png',
      stadium: 'Anfield',
      leagueId: 'uuid-pl',
      gamesPlayed: 20,
      gamesWon: 14,
      gamesDrawn: 3,
      gamesLost: 3,
      goalsScoredPerGame: 2.5,
      goalsConcededPerGame: 1.0,
      pointsPerGame: 2.25,
    },
  ];

  const mockApiTeam = {
    id: 1,
    name: 'Manchester United',
    shortName: 'Man United',
    tla: 'MUN',
    crest: 'https://example.com/mun.png',
    address: 'Sir Matt Busby Way, Manchester',
    website: 'https://manutd.com',
    founded: 1878,
    clubColors: 'Red / White',
    venue: 'Old Trafford',
    area: { id: 2072, name: 'England', code: 'ENG' },
  };

  // Mock repository with query builder
  const mockRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
      getOne: jest.fn(),
    })),
  };

  const mockFixtureRepository = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    })),
  };

  // Mock API service
  const mockApiService = {
    getTeams: jest.fn(),
    getTeam: jest.fn(),
    getTeamMatches: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        {
          provide: getRepositoryToken(Team),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Fixture),
          useValue: mockFixtureRepository,
        },
        {
          provide: FootballDataOrgService,
          useValue: mockApiService,
        },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
    apiService = module.get<FootballDataOrgService>(FootballDataOrgService);
    repository = module.get<Repository<Team>>(getRepositoryToken(Team));

    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return all teams', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockTeams),
        getOne: jest.fn(),
      };
      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.findAll();

      expect(result).toEqual(mockTeams);
    });

    it('should filter by league when leagueId provided', async () => {
      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockTeams[0]]),
        getOne: jest.fn(),
      };
      mockRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.findAll({ leagueId: 'uuid-pl' });

      expect(result).toHaveLength(1);
    });
  });

  describe('findOne', () => {
    it('should return a single team by id', async () => {
      mockRepository.findOne.mockResolvedValue(mockTeams[0]);

      const result = await service.findOne('uuid-1');

      expect(result).toEqual(mockTeams[0]);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
        relations: ['league'],
      });
    });

    it('should throw NotFoundException if team not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByExternalId', () => {
    it('should return team by external ID', async () => {
      mockRepository.findOne.mockResolvedValue(mockTeams[0]);

      const result = await service.findByExternalId(1);

      expect(result).toEqual(mockTeams[0]);
      expect(mockRepository.findOne).toHaveBeenCalledWith({
        where: { externalId: 1 },
        relations: ['league'],
      });
    });

    it('should return null if team not found', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findByExternalId(999);

      expect(result).toBeNull();
    });
  });

  describe('getForm', () => {
    it('should return team form as W/D/L array', async () => {
      const builder = (fixtures: any[]) => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(fixtures),
      });

      mockFixtureRepository.createQueryBuilder
        .mockReturnValueOnce(builder([
          // team is home and wins 2-1
          { homeTeamId: 'uuid-1', awayTeamId: 'uuid-2', homeGoals: 2, awayGoals: 1, kickoff: new Date() },
        ]))
        .mockReturnValueOnce(builder([
          // team is away and draws 1-1
          { homeTeamId: 'uuid-2', awayTeamId: 'uuid-1', homeGoals: 1, awayGoals: 1, kickoff: new Date(Date.now() - 1000) },
        ]));

      const result = await service.getForm('uuid-1', 2);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(2);
    });
  });

  describe('syncTeams', () => {
    it('should create new teams from API', async () => {
      mockApiService.getTeams.mockResolvedValue([mockApiTeam]);
      mockRepository.findOne.mockResolvedValue(null);
      mockRepository.create.mockReturnValue({ ...mockTeams[0], externalId: 1 });
      mockRepository.save.mockResolvedValue({ ...mockTeams[0], externalId: 1 });

      const result = await service.syncTeams('PL', 'uuid-pl');

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(mockApiService.getTeams).toHaveBeenCalledWith('PL');
    });

    it('should update existing teams', async () => {
      mockApiService.getTeams.mockResolvedValue([mockApiTeam]);
      mockRepository.findOne.mockResolvedValue({ ...mockTeams[0], id: 'uuid-existing' });
      mockRepository.save.mockResolvedValue(mockTeams[0]);

      const result = await service.syncTeams('PL', 'uuid-pl');

      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
    });
  });
});
