# AI Football Prediction API

A NestJS-based backend API that uses Machine Learning to predict football match outcomes for Europe's top 5 leagues.

## Features

- Predicts match results (Home Win / Draw / Away Win) with confidence scores
- Aggregates data from multiple free APIs
- Scheduled data sync for fixtures, teams, and standings
- Redis caching for improved performance
- PostgreSQL database for data storage

## Tech Stack

- **Framework**: NestJS + TypeScript
- **Database**: PostgreSQL (via Docker)
- **Cache**: Redis (via Docker)
- **ORM**: TypeORM
- **Scheduling**: @nestjs/schedule

## Quick Start

### 1. Start Docker Services

```bash
# Start PostgreSQL and Redis containers
docker-compose up -d

# Verify containers are running
docker-compose ps
```

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your Football-Data API key
# Get a free key at https://www.football-data.org/
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Application

```bash
# Development mode with hot reload
npm run start:dev
```

### 5. Trigger Initial Data Sync

```bash
curl -X POST http://localhost:3000/api/sync
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fixtures` | Get all fixtures with filters |
| GET | `/api/fixtures/today` | Today's fixtures |
| GET | `/api/fixtures/upcoming` | Next 7 days fixtures |
| GET | `/api/fixtures/:id` | Single fixture |
| GET | `/api/teams` | Get all teams |
| GET | `/api/teams/:id` | Single team |
| GET | `/api/teams/:id/form` | Team form (last 5 games) |
| POST | `/api/sync` | Trigger manual data sync |

## Project Structure

```
src/
├── config/                 # Configuration files
├── common/                 # Shared services (cache, etc.)
├── modules/
│   ├── football/          # Football data entities, services, controllers
│   └── sync/              # Data sync scheduling
├── app.module.ts          # Main application module
└── main.ts               # Application entry point
```

## Supported Leagues

- Premier League (England)
- La Liga (Spain)
- Bundesliga (Germany)
- Serie A (Italy)
- Ligue 1 (France)

## Running Tests

```bash
# Unit tests
npm run test

# e2e tests
npm run test:e2e

# Test coverage
npm run test:cov
```

## License

MIT
