# Football Prediction Backend Architecture Plan (Complete Edition)

**Scope**: Top 5 European Leagues | **Budget**: Free APIs Only | **ML**: Custom Model for Best Results

---

## Table of Contents

- [Target Leagues](#target-leagues)
- [Free API Strategy](#free-api-strategy)
- [Custom ML Prediction Approach](#custom-ml-prediction-approach)
- [Enhanced Features & Improvements](#enhanced-features--improvements)
- [Complete Module Architecture](#complete-module-architecture)
- [Core Entities](#core-entities)
- [Essential Services](#essential-services)
- [Data Sync Strategy](#data-sync-strategy)
- [API Endpoints](#api-endpoints)
- [Background Jobs & Scheduling](#background-jobs--scheduling)
- [Testing Strategy](#testing-strategy)
- [Implementation Phases](#implementation-phases)
- [Tech Stack Summary](#tech-stack-summary)

---

## Target Leagues

| League | Country | football-data.org Code | Season |
|--------|---------|------------------------|--------|
| Premier League | England | `PL` | Current |
| La Liga | Spain | `PD` | Current |
| Bundesliga | Germany | `BL1` | Current |
| Serie A | Italy | `SA` | Current |
| Ligue 1 | France | `FL1` | Current |

> **Note**: football-data.org is the primary data source for fixtures, teams, standings, and matches (10 req/min free tier).

---

## Free API Strategy

> [!IMPORTANT]
> We stay within free tiers by using football-data.org as the core feed and supplementing only where it has gaps.

### Multi-API Architecture

```mermaid
graph LR
    subgraph "Primary Data Source"
        FDO[football-data.org v4]
    end
    
    subgraph "Supplementary Data"
        FPL[Fantasy PL API]
        MANUAL[Manual Injuries (non-PL)]
        WEATHER[Open-Meteo]
        STATS[StatsBomb Open Data]
    end
    
    subgraph "NestJS Backend"
        SYNC[Sync + DB]
        FE[Feature Engineering]
    end
    
    FDO -->|Fixtures, Teams, Standings, Matches| SYNC
    FPL -->|PL Injuries| SYNC
    MANUAL -->|Non-PL Injuries| SYNC
    WEATHER -->|Match Conditions| FE
    STATS -->|Historical xG (training)| FE
    SYNC --> FE
```

**Why football-data.org as Primary?**
- Free and stable REST API
- Current-season coverage for top European leagues
- Straightforward endpoints for fixtures, teams, matches, standings
- Works well with rate-limited sync + caching

### API Comparison & Strategy

| API | Free Limits | Data We'll Use | Priority |
|-----|-------------|----------------|----------|
| **football-data.org** | 10 req/min | Fixtures, Teams, Standings, Matches | **Primary** |
| **Fantasy PL API** | Unlimited | PL injuries | Supplementary |
| **Open-Meteo** | Unlimited | Weather conditions | Supplementary |
| **StatsBomb Open Data** | Unlimited (GitHub) | Historical xG for training | Training Only |
| **Manual Entry** | N/A | Non-PL injuries | As needed |

### Rate Limit Management

```typescript
// Smart request pooling across APIs
const API_LIMITS = {
  'football-data-org': { perMinute: 10 },
  'fantasy-pl': { perMinute: Infinity },
  'open-meteo': { perMinute: Infinity },
};

// Sync pacing for football-data.org free tier
const SYNC_DELAYS_MS = {
  between_calls: 6000, // 10 req/min
};
```

---

## Football-Data.org Integration Guide

### Getting Started with football-data.org

1. Create a free account and API key at football-data.org
2. Store the key in `.env`

```bash
# .env
FOOTBALL_DATA_API_KEY=your_api_key_here
FOOTBALL_DATA_BASE_URL=https://api.football-data.org/v4
```

### API Base Configuration

```typescript
// src/config/configuration.ts
footballDataOrg: {
  baseUrl: process.env.FOOTBALL_DATA_BASE_URL || 'https://api.football-data.org/v4',
  apiKey: process.env.FOOTBALL_DATA_API_KEY || '',
},
```

### Core Endpoints (free tier)

- `GET /competitions/{code}/matches`
- `GET /competitions/{code}/teams`
- `GET /competitions/{code}/standings`
- `GET /teams/{id}/matches`

### Notes

- Free tier limit: **10 requests/minute** (use 6s delays + caching)
- No odds or injuries in free tier â€” PL injuries come from FPL API

<!--
### Deprecated API Integration (removed)

#### 1. Sign Up & Get API Key

1. Visit the provider website (deprecated)
2. Click "Register" (No credit card required)
3. Verify your email
4. Get your API key from the dashboard
5. Store it securely in `.env`

```bash
# .env
DEPRECATED_API_KEY=your_api_key_here
DEPRECATED_API_HOST=deprecated.host
```

#### 2. API Base Configuration

```typescript
// src/config/apis.config.ts
export const apiFootballConfig = {
  baseURL: 'https://v3.football.api-sports.io',
  headers: {
    'x-rapidapi-key': process.env.DEPRECATED_API_KEY,
    'x-rapidapi-host': process.env.DEPRECATED_API_HOST,
  },
  timeout: 10000,
  limits: {
    requestsPerMinute: 10,
    requestsPerDay: 100,
  },
};
```

### Core Endpoints Reference

#### Fixtures Endpoint

**Get Fixtures by League and Season**
```typescript
// GET /fixtures?league=39&season=2024
const getFixtures = async (leagueId: number, season: number) => {
  const response = await axios.get(`${baseURL}/fixtures`, {
    params: { league: leagueId, season },
    headers: apiHeaders,
  });
  return response.data;
};

// Response structure
{
  "response": [
    {
      "fixture": {
        "id": 1035046,
        "referee": "Michael Oliver",
        "timezone": "UTC",
        "date": "2024-02-04T15:00:00+00:00",
        "timestamp": 1707055200,
        "venue": {
          "id": 494,
          "name": "Etihad Stadium",
          "city": "Manchester"
        },
        "status": {
          "long": "Not Started",
          "short": "NS",
          "elapsed": null
        }
      },
      "league": {
        "id": 39,
        "name": "Premier League",
        "country": "England",
        "season": 2024,
        "round": "Regular Season - 24"
      },
      "teams": {
        "home": {
          "id": 50,
          "name": "Manchester City",
          "logo": "https://...",
          "winner": null
        },
        "away": {
          "id": 33,
          "name": "Manchester United",
          "logo": "https://...",
          "winner": null
        }
      },
      "goals": {
        "home": null,
        "away": null
      },
      "score": {
        "halftime": { "home": null, "away": null },
        "fulltime": { "home": null, "away": null }
      }
    }
  ]
}
```

**Get Live Fixtures**
```typescript
// GET /fixtures?live=all (or specific league)
const getLiveFixtures = async () => {
  const response = await axios.get(`${baseURL}/fixtures`, {
    params: { live: 'all' },
    headers: apiHeaders,
  });
  return response.data.response;
};
```

**Get Fixtures by Date Range**
```typescript
// GET /fixtures?from=2024-02-01&to=2024-02-07
const getFixturesByDateRange = async (from: string, to: string) => {
  const response = await axios.get(`${baseURL}/fixtures`, {
    params: { from, to },
    headers: apiHeaders,
  });
  return response.data.response;
};
```

#### Standings Endpoint

```typescript
// GET /standings?league=39&season=2024
const getStandings = async (leagueId: number, season: number) => {
  const response = await axios.get(`${baseURL}/standings`, {
    params: { league: leagueId, season },
    headers: apiHeaders,
  });
  return response.data;
};

// Response structure
{
  "response": [
    {
      "league": {
        "id": 39,
        "name": "Premier League",
        "season": 2024,
        "standings": [[
          {
            "rank": 1,
            "team": {
              "id": 50,
              "name": "Manchester City",
              "logo": "https://..."
            },
            "points": 56,
            "goalsDiff": 35,
            "group": "Premier League",
            "form": "WWWDW",
            "status": "same",
            "description": "Promotion - Champions League",
            "all": {
              "played": 24,
              "win": 17,
              "draw": 5,
              "lose": 2,
              "goals": { "for": 60, "against": 25 }
            },
            "home": {
              "played": 12,
              "win": 9,
              "draw": 2,
              "lose": 1,
              "goals": { "for": 32, "against": 12 }
            },
            "away": {
              "played": 12,
              "win": 8,
              "draw": 3,
              "lose": 1,
              "goals": { "for": 28, "against": 13 }
            }
          }
        ]]
      }
    }
  ]
}
```

#### Head-to-Head Endpoint

```typescript
// GET /fixtures/headtohead?h2h=33-34
const getH2H = async (team1Id: number, team2Id: number) => {
  const response = await axios.get(`${baseURL}/fixtures/headtohead`, {
    params: { h2h: `${team1Id}-${team2Id}` },
    headers: apiHeaders,
  });
  return response.data.response;
};
```

#### Team Statistics Endpoint

```typescript
// GET /teams/statistics?league=39&season=2024&team=50
const getTeamStatistics = async (
  leagueId: number, 
  season: number, 
  teamId: number
) => {
  const response = await axios.get(`${baseURL}/teams/statistics`, {
    params: { league: leagueId, season, team: teamId },
    headers: apiHeaders,
  });
  return response.data;
};

// Response includes:
{
  "form": "WWDLW",
  "fixtures": {
    "played": { "home": 12, "away": 12, "total": 24 },
    "wins": { "home": 9, "away": 8, "total": 17 },
    "draws": { "home": 2, "away": 3, "total": 5 },
    "loses": { "home": 1, "away": 1, "total": 2 }
  },
  "goals": {
    "for": {
      "total": { "home": 32, "away": 28, "total": 60 },
      "average": { "home": "2.7", "away": "2.3", "total": "2.5" }
    },
    "against": {
      "total": { "home": 12, "away": 13, "total": 25 },
      "average": { "home": "1.0", "away": "1.1", "total": "1.0" }
    }
  },
  "clean_sheet": { "home": 7, "away": 6, "total": 13 },
  "failed_to_score": { "home": 1, "away": 2, "total": 3 }
}
```

#### Injuries/Sidelined Endpoint

```typescript
// GET /injuries?league=39&season=2024&team=50
const getInjuries = async (
  leagueId: number,
  season: number,
  teamId?: number
) => {
  const response = await axios.get(`${baseURL}/injuries`, {
    params: { league: leagueId, season, team: teamId },
    headers: apiHeaders,
  });
  return response.data.response;
};

// Response structure
{
  "response": [
    {
      "player": {
        "id": 306,
        "name": "K. De Bruyne",
        "photo": "https://..."
      },
      "team": {
        "id": 50,
        "name": "Manchester City",
        "logo": "https://..."
      },
      "fixture": {
        "id": 1035046,
        "date": "2024-02-04T15:00:00+00:00"
      },
      "league": {
        "id": 39,
        "name": "Premier League",
        "season": 2024
      },
      "type": "Missing Fixture",
      "reason": "Injury"
    }
  ]
}
```

#### Predictions Endpoint (Bonus!)

```typescript
// GET /predictions?fixture=1035046
const getPrediction = async (fixtureId: number) => {
  const response = await axios.get(`${baseURL}/predictions`, {
    params: { fixture: fixtureId },
    headers: apiHeaders,
  });
  return response.data.response;
};

// Returns AI prediction from deprecated provider (removed)
{
  "predictions": {
    "winner": {
      "id": 50,
      "name": "Manchester City",
      "comment": "Win or draw"
    },
    "win_or_draw": true,
    "under_over": "Over 2.5",
    "goals": {
      "home": "2.0",
      "away": "1.0"
    },
    "advice": "Combo Double chance : Home/Draw + Over 2.5"
  },
  "comparison": {
    "form": { "home": "83%", "away": "67%" },
    "att": { "home": "95%", "away": "78%" },
    "def": { "home": "92%", "away": "65%" }
  }
}
```

#### Odds Endpoint

```typescript
// GET /odds?fixture=1035046&bookmaker=8
const getOdds = async (fixtureId: number, bookmakerId: number = 8) => {
  const response = await axios.get(`${baseURL}/odds`, {
    params: { fixture: fixtureId, bookmaker: bookmakerId },
    headers: apiHeaders,
  });
  return response.data.response;
};
```

### League ID Reference

```typescript
export const LEAGUE_IDS = {
  PREMIER_LEAGUE: 39,
  LA_LIGA: 140,
  BUNDESLIGA: 78,
  SERIE_A: 135,
  LIGUE_1: 61,
  CHAMPIONS_LEAGUE: 2,
  EUROPA_LEAGUE: 3,
  FA_CUP: 45,
  COPA_DEL_REY: 143,
  DFB_POKAL: 81,
  COPPA_ITALIA: 137,
  COUPE_DE_FRANCE: 66,
};

export const CURRENT_SEASON = 2024;
```

### NestJS Service Implementation

```typescript
// src/modules/football/services/deprecated-api.service.ts
import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { ApiRateLimiterService } from '@/common/services/api-rate-limiter.service';

@Injectable()
export class ApiFootballService {
  private readonly logger = new Logger(ApiFootballService.name);
  private readonly axiosInstance: AxiosInstance;

  constructor(
    private configService: ConfigService,
    private rateLimiter: ApiRateLimiterService,
  ) {
    this.axiosInstance = axios.create({
      baseURL: 'https://v3.football.api-sports.io',
      timeout: 10000,
      headers: {
        'x-rapidapi-key': this.configService.get('DEPRECATED_API_KEY'),
        'x-rapidapi-host': 'deprecated.host',
      },
    });
  }

  async getFixtures(leagueId: number, season: number) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const response = await this.axiosInstance.get('/fixtures', {
          params: { league: leagueId, season },
        });
        
        this.logger.log(`Fetched ${response.data.results} fixtures for league ${leagueId}`);
        return response.data.response;
      },
    );
  }

  async getFixturesByDateRange(from: string, to: string) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const response = await this.axiosInstance.get('/fixtures', {
          params: { from, to },
        });
        return response.data.response;
      },
    );
  }

  async getLiveFixtures(leagueId?: number) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const params = leagueId ? { live: leagueId } : { live: 'all' };
        const response = await this.axiosInstance.get('/fixtures', { params });
        return response.data.response;
      },
    );
  }

  async getStandings(leagueId: number, season: number) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const response = await this.axiosInstance.get('/standings', {
          params: { league: leagueId, season },
        });
        return response.data.response[0]?.league.standings[0] || [];
      },
    );
  }

  async getH2H(team1Id: number, team2Id: number, last: number = 10) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const response = await this.axiosInstance.get('/fixtures/headtohead', {
          params: { h2h: `${team1Id}-${team2Id}`, last },
        });
        return response.data.response;
      },
    );
  }

  async getTeamStatistics(leagueId: number, season: number, teamId: number) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const response = await this.axiosInstance.get('/teams/statistics', {
          params: { league: leagueId, season, team: teamId },
        });
        return response.data.response;
      },
    );
  }

  async getInjuries(leagueId: number, season: number, teamId?: number) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const params: any = { league: leagueId, season };
        if (teamId) params.team = teamId;
        
        const response = await this.axiosInstance.get('/injuries', { params });
        return response.data.response;
      },
    );
  }

  async getAPIPrediction(fixtureId: number) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const response = await this.axiosInstance.get('/predictions', {
          params: { fixture: fixtureId },
        });
        return response.data.response[0];
      },
    );
  }

  async getOdds(fixtureId: number, bookmakerId: number = 8) {
    return this.rateLimiter.executeRequest(
      'deprecated-api',
      async () => {
        const response = await this.axiosInstance.get('/odds', {
          params: { fixture: fixtureId, bookmaker: bookmakerId },
        });
        return response.data.response;
      },
    );
  }
}
```

### Error Handling Best Practices

```typescript
// Add interceptor for error handling
this.axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status, data } = error.response;
      
      // Rate limit exceeded
      if (status === 429) {
        this.logger.error('External API rate limit exceeded');
        throw new HttpException(
          'API rate limit exceeded. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      
      // Invalid API key
      if (status === 401 || status === 403) {
        this.logger.error('External API authentication failed');
        throw new HttpException(
          'API authentication failed',
          HttpStatus.UNAUTHORIZED,
        );
      }
      
      // API error
      this.logger.error(`External API error: ${data.message || 'Unknown error'}`);
      throw new HttpException(
        data.message || 'External API error',
        HttpStatus.BAD_GATEWAY,
      );
    }
    
    throw error;
  },
);
```

### Testing the Integration

```typescript
// Test script: scripts/test-deprecated-api.ts
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.DEPRECATED_API_KEY;
const baseURL = 'https://v3.football.api-sports.io';

async function testAPI() {
  try {
    // Test 1: Get Premier League fixtures
    console.log('Testing fixtures endpoint...');
    const fixturesResponse = await axios.get(`${baseURL}/fixtures`, {
      params: { league: 39, season: 2024, next: 5 },
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io',
      },
    });
    console.log(`✅ Fixtures: ${fixturesResponse.data.results} matches found`);

    // Test 2: Get standings
    console.log('\nTesting standings endpoint...');
    const standingsResponse = await axios.get(`${baseURL}/standings`, {
      params: { league: 39, season: 2024 },
      headers: {
        'x-rapidapi-key': apiKey,
        'x-rapidapi-host': 'v3.football.api-sports.io',
      },
    });
    console.log('✅ Standings retrieved successfully');

    // Test 3: Check API quota
    const quotaInfo = fixturesResponse.headers['x-ratelimit-requests-remaining'];
    console.log(`\n📊 Requests remaining today: ${quotaInfo}`);

  } catch (error) {
    console.error('❌ API Test Failed:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

testAPI();
```

Run test:
```bash
npm run ts-node scripts/test-deprecated-api.ts
```

---

-->
## Custom ML Prediction Approach

> [!TIP]
> Building our own model gives better accuracy than pre-built predictions and allows full control over features.

### ML Architecture

```mermaid
flowchart TB
    subgraph "Data Collection"
        SYNC[Scheduled Sync Jobs]
    end
    
    subgraph "Feature Store"
        DB[(PostgreSQL)]
    end
    
    subgraph "Feature Engineering"
        FE[Feature Engineering Service]
        DQ[Data Quality Service]
    end
    
    subgraph "ML Pipeline"
        TRAIN[Model Training Python]
        TUNE[Hyperparameter Tuning]
        MODEL[Trained Models .onnx]
        INFER[Inference Service]
    end
    
    subgraph "Predictions"
        PRED[Prediction Service]
        CONF[Confidence Scoring]
    end
    
    subgraph "Monitoring"
        MONITOR[Model Monitoring]
        DRIFT[Drift Detection]
    end
    
    SYNC --> DB
    DB --> FE
    FE --> DQ
    DQ --> TRAIN
    TRAIN --> TUNE
    TUNE --> MODEL
    MODEL --> INFER
    INFER --> PRED
    PRED --> CONF
    CONF --> MONITOR
    MONITOR --> DRIFT
    DRIFT -.->|Retrain Trigger| TRAIN
```

### Model Stack (Enhanced)

| Model | Task | Why | Priority |
|-------|------|-----|----------|
| **XGBoost** | Match outcome (1X2) | Excellent for tabular data, handles imbalanced classes | Primary |
| **Random Forest** | Goal totals (O/U 2.5) | Robust, interpretable | Primary |
| **Poisson Regression** | Expected goals | Statistically grounded for goal prediction | Primary |
| **Logistic Regression** | Baseline model | Simple, fast, validates complex models add value | Baseline |

### Ensemble Strategy

```typescript
class EnsemblePredictor {
  models = {
    xgboost: { weight: 0.5 },      // Best for outcome
    randomForest: { weight: 0.3 },  // Robust backup
    poisson: { weight: 0.2 }        // Goal scoring
  };
  
  // Weighted averaging for final prediction
  predict(features: MatchFeatures): Prediction {
    const predictions = Object.entries(this.models).map(([name, config]) => {
      const modelPrediction = this.getModel(name).predict(features);
      return {
        homeWinProb: modelPrediction.homeWinProb * config.weight,
        drawProb: modelPrediction.drawProb * config.weight,
        awayWinProb: modelPrediction.awayWinProb * config.weight,
      };
    });
    
    return this.aggregate(predictions);
  }
}
```

### Feature Categories (30 Total Features - Enhanced)

| Category | Features | Count | New |
|----------|----------|-------|-----|
| **Form** | Last 5 W/D/L, goals scored/conceded, points per game (home/away) | 6 | - |
| **Strength** | League position, goal difference, avg goals per game, expected goals (xG) | 5 | ✅ xG |
| **H2H** | Last 5 meetings result, home team H2H wins, total goals avg | 3 | - |
| **Context** | Home advantage factor, days since last match, distance traveled | 3 | - |
| **Injuries** | Key players missing count, goalkeeper available, top scorer available, impact score | 4 | ✅ impact score |
| **Momentum** | Win streak, unbeaten streak, clean sheet streak | 4 | - |
| **Managerial** | Manager tenure, manager win rate | 2 | ✅ New |
| **Environmental** | Weather conditions (rain/wind), temperature | 2 | ✅ New |
| **Market** | Betting odds baseline (market wisdom) | 1 | ✅ New |

### Model Training Pipeline

```
ml/
├── training/
│   ├── train.py                    # Main training script
│   ├── feature_engineering.py      # Feature extraction
│   ├── evaluate_model.py           # Accuracy metrics
│   ├── hyperparameter_tuning.py    # Grid/random search
│   └── baseline_models.py          # Logistic regression baseline
│
├── models/
│   ├── xgboost_v1.onnx
│   ├── random_forest_v1.onnx
│   ├── poisson_v1.onnx
│   ├── logistic_v1.onnx
│   └── metadata.json               # Model version tracking
│
├── monitoring/
│   ├── drift_detection.py          # Feature/concept drift
│   ├── performance_tracking.py     # Accuracy over time
│   └── calibration_check.py        # Probability calibration
│
├── export/
│   └── export_onnx.py              # Export for Node.js
│
└── requirements.txt
```

---

## Enhanced Features & Improvements

### 1. Model Monitoring Service

**Purpose**: Track model performance and detect degradation

```typescript
// src/modules/ml-monitoring/services/model-monitoring.service.ts
@Injectable()
export class ModelMonitoringService {
  
  // Track prediction accuracy over time
  async trackPredictionAccuracy(prediction: Prediction, actualResult: string) {
    const accuracy = this.calculateAccuracy(prediction, actualResult);
    const brierScore = this.calculateBrierScore(prediction, actualResult);
    
    // Store in time-series
    await this.metricsRepository.save({
      date: new Date(),
      modelVersion: prediction.modelVersion,
      accuracy,
      brierScore,
      calibration: this.checkCalibration(prediction, actualResult),
      roi: this.calculateROI(prediction, actualResult)
    });
    
    // Alert if accuracy drops below threshold
    if (accuracy < 0.45) {
      await this.alertService.send({
        type: 'MODEL_DRIFT_DETECTED',
        severity: 'HIGH',
        message: `Model accuracy dropped to ${accuracy}`,
      });
    }
  }
  
  // Detect model drift
  async checkModelDrift(): Promise<DriftStatus> {
    const last30Days = await this.getRecentMetrics(30);
    const last7Days = await this.getRecentMetrics(7);
    
    const accuracyDrop = last30Days.accuracy - last7Days.accuracy;
    
    if (accuracyDrop > 0.05) {
      // Trigger retraining
      await this.retrainingService.scheduleRetrain({
        reason: 'ACCURACY_DRIFT',
        currentAccuracy: last7Days.accuracy,
        previousAccuracy: last30Days.accuracy,
      });
      
      return { isDrifting: true, severity: 'HIGH' };
    }
    
    return { isDrifting: false, severity: 'NONE' };
  }
  
  // Calculate Brier Score (probability calibration)
  private calculateBrierScore(prediction: Prediction, actualResult: string): number {
    const outcomes = {
      'HOME': prediction.homeWinProb,
      'DRAW': prediction.drawProb,
      'AWAY': prediction.awayWinProb,
    };
    
    let score = 0;
    for (const [outcome, prob] of Object.entries(outcomes)) {
      const actual = outcome === actualResult ? 1 : 0;
      score += Math.pow(prob - actual, 2);
    }
    
    return score / 3; // Average over 3 outcomes
  }
}
```

### 2. Data Quality Service

**Purpose**: Validate data before it reaches the ML model

```typescript
// src/modules/data-quality/services/data-quality.service.ts
@Injectable()
export class DataQualityService {
  
  validateFeatures(features: MatchFeatures): ValidationResult {
    const issues: string[] = [];
    let confidence = 1.0;
    
    // Check for missing critical data
    if (!features.homeForm || features.homeForm.gamesPlayed < 5) {
      issues.push('Insufficient home team form data');
      confidence *= 0.8;
    }
    
    if (!features.awayForm || features.awayForm.gamesPlayed < 5) {
      issues.push('Insufficient away team form data');
      confidence *= 0.8;
    }
    
    // Check for outliers
    if (features.homeGoalsPerGame > 5) {
      issues.push('Unrealistic home goals per game - possible data error');
      confidence *= 0.7;
    }
    
    // Check data freshness
    const daysSinceUpdate = (Date.now() - features.lastUpdated) / (24 * 60 * 60 * 1000);
    if (daysSinceUpdate > 1) {
      issues.push(`Stale data - ${daysSinceUpdate.toFixed(1)} days old`);
      confidence *= 0.9;
    }
    
    // Check injury data availability
    if (!features.homeInjuries) {
      issues.push('Missing home team injury data');
      confidence *= 0.95;
    }
    
    // Check head-to-head data
    if (!features.headToHead || features.headToHead.matchesPlayed < 3) {
      issues.push('Limited head-to-head history');
      confidence *= 0.9;
    }
    
    return {
      isValid: issues.length === 0,
      confidence: Math.max(confidence, 0.3), // Minimum 30% confidence
      issues,
      severity: confidence < 0.5 ? 'HIGH' : confidence < 0.7 ? 'MEDIUM' : 'LOW',
    };
  }
  
  // Clean and normalize features
  cleanFeatures(features: MatchFeatures): MatchFeatures {
    // Cap outliers
    features.homeGoalsPerGame = Math.min(features.homeGoalsPerGame, 4);
    features.awayGoalsPerGame = Math.min(features.awayGoalsPerGame, 4);
    
    // Fill missing values with league averages
    if (!features.homeInjuries) {
      features.homeInjuries = this.getLeagueAverageInjuries(features.league);
    }
    
    return features;
  }
}
```

### 3. Enhanced Injury Impact System

```typescript
// src/modules/injuries/entities/injury-impact.entity.ts
@Entity('injury_impact')
export class InjuryImpact {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  playerId: number;
  
  @Column()
  teamId: number;
  
  @Column()
  playerName: string;
  
  // Player importance metrics
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  playerImportance: number; // 0-100 based on minutes, goals, assists
  
  @Column({ type: 'enum', enum: ['GK', 'DEF', 'MID', 'FWD'] })
  positionCriticality: string;
  
  @Column({ type: 'jsonb' })
  playerStats: {
    minutesPlayed: number;
    goals: number;
    assists: number;
    cleanSheets?: number;
    rating: number;
  };
  
  // Team performance without this player
  @Column({ type: 'jsonb' })
  teamPerformanceWithout: {
    matchesPlayed: number;
    winRate: number;
    goalsPerGame: number;
    goalsConcededPerGame: number;
    pointsPerGame: number;
  };
  
  // Calculated impact score for ML model
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  impactScore: number; // 0-10 weighted score
  
  @Column()
  injuryStatus: 'OUT' | 'DOUBTFUL' | 'RECOVERING';
  
  @Column({ type: 'date', nullable: true })
  expectedReturn: Date;
  
  @Column({ type: 'timestamp' })
  lastUpdated: Date;
}

// src/modules/injuries/services/injury-impact.service.ts
@Injectable()
export class InjuryImpactService {
  
  calculateInjuryImpact(injuries: InjuryImpact[]): number {
    if (!injuries || injuries.length === 0) return 0;
    
    let totalImpact = 0;
    
    for (const injury of injuries) {
      // Weight by position criticality
      const positionWeights = {
        'GK': 1.5,  // Goalkeeper injuries are critical
        'DEF': 1.0,
        'MID': 1.2,
        'FWD': 1.3,
      };
      
      // Weight by player importance
      const importanceWeight = injury.playerImportance / 100;
      
      // Weight by injury status
      const statusWeights = {
        'OUT': 1.0,
        'DOUBTFUL': 0.5,
        'RECOVERING': 0.3,
      };
      
      const impact = 
        positionWeights[injury.positionCriticality] *
        importanceWeight *
        statusWeights[injury.injuryStatus];
      
      totalImpact += impact;
    }
    
    // Normalize to 0-10 scale
    return Math.min(totalImpact * 2, 10);
  }
}
```

### 4. Prediction Confidence Scoring

```typescript
// src/modules/predictions/services/confidence-scoring.service.ts
@Injectable()
export class ConfidenceScoringService {
  
  async calculateConfidence(
    prediction: Prediction,
    features: MatchFeatures,
  ): Promise<PredictionWithConfidence> {
    const breakdown = {
      dataQuality: await this.assessDataQuality(features),
      modelCertainty: this.assessModelCertainty(prediction),
      historicalAccuracy: await this.getRecentModelAccuracy(),
      contextualFactors: this.assessContextualFactors(features),
    };
    
    // Weighted average
    const weights = {
      dataQuality: 0.3,
      modelCertainty: 0.3,
      historicalAccuracy: 0.25,
      contextualFactors: 0.15,
    };
    
    const overallConfidence = Object.entries(breakdown).reduce(
      (sum, [key, value]) => sum + value * weights[key],
      0
    );
    
    return {
      ...prediction,
      confidence: overallConfidence,
      confidenceBreakdown: breakdown,
    };
  }
  
  private assessDataQuality(features: MatchFeatures): number {
    let score = 1.0;
    
    // Reduce for missing data
    if (!features.homeInjuries) score *= 0.9;
    if (!features.awayInjuries) score *= 0.9;
    if (!features.weather) score *= 0.95;
    if (!features.headToHead || features.headToHead.matchesPlayed < 5) score *= 0.85;
    
    // Check data freshness
    const daysSinceUpdate = (Date.now() - features.lastUpdated) / (24 * 60 * 60 * 1000);
    if (daysSinceUpdate > 1) score *= 0.9;
    
    return score;
  }
  
  private assessModelCertainty(prediction: Prediction): number {
    // Higher probability spread = more certain
    const probs = [
      prediction.homeWinProb,
      prediction.drawProb,
      prediction.awayWinProb
    ];
    
    const maxProb = Math.max(...probs);
    const minProb = Math.min(...probs);
    const spread = maxProb - minProb;
    
    // If one outcome has >60% probability, we're quite certain
    if (maxProb > 0.6) return 0.9;
    if (maxProb > 0.5) return 0.75;
    if (spread < 0.2) return 0.5; // Very uncertain
    
    return 0.7;
  }
  
  private async getRecentModelAccuracy(): Promise<number> {
    // Get model's accuracy over last 7 days
    const metrics = await this.modelMetricsRepository.find({
      where: {
        date: MoreThan(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
      },
    });
    
    if (metrics.length === 0) return 0.7; // Default
    
    const avgAccuracy = metrics.reduce((sum, m) => sum + m.accuracy, 0) / metrics.length;
    return avgAccuracy;
  }
  
  private assessContextualFactors(features: MatchFeatures): number {
    let score = 1.0;
    
    // Reduce confidence for newly promoted teams (less data)
    if (features.homeTeam.leagueTenure < 2) score *= 0.85;
    if (features.awayTeam.leagueTenure < 2) score *= 0.85;
    
    // Reduce for new managers (unpredictable)
    if (features.homeTeam.managerTenure < 10) score *= 0.9;
    if (features.awayTeam.managerTenure < 10) score *= 0.9;
    
    // Reduce for unusual weather
    if (features.weather?.condition === 'STORM' || features.weather?.condition === 'SNOW') {
      score *= 0.8;
    }
    
    return score;
  }
}
```

### 5. Smart API Rate Limiter

```typescript
// src/common/services/api-rate-limiter.service.ts
@Injectable()
export class ApiRateLimiterService {
  private queues: Map<string, Queue> = new Map();
  private dailyCounters: Map<string, number> = new Map();
  
  constructor(
    private redis: Redis,
    private logger: Logger,
  ) {
    this.initializeQueues();
  }
  
  private initializeQueues() {
    // Football-Data.org: 10 req/min
    this.queues.set('football-data', new Queue('football-data-api', {
      redis: this.redis,
      limiter: {
        max: 10,
        duration: 60000, // 1 minute
      },
    }));
    
    // Open-Meteo: unlimited (soft cap 60 req/min)
    this.queues.set('open-meteo', new Queue('weather-api', {
      redis: this.redis,
      limiter: {
        max: 60,
        duration: 60000,
      },
    }));
  }
  
  async executeRequest<T>(
    apiName: string,
    requestFn: () => Promise<T>,
    priority: number = 0,
  ): Promise<T> {
    // Check daily limit first
    const canProceed = await this.checkDailyLimit(apiName);
    if (!canProceed) {
      throw new Error(`Daily limit exceeded for ${apiName}`);
    }
    
    const queue = this.queues.get(apiName);
    if (!queue) {
      throw new Error(`Unknown API: ${apiName}`);
    }
    
    return new Promise((resolve, reject) => {
      queue.add(
        'api-request',
        { requestFn: requestFn.toString() },
        {
          priority,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        }
      );
      
      queue.process('api-request', async (job) => {
        try {
          this.logger.log(`Executing ${apiName} request`);
          const result = await requestFn();
          await this.incrementDailyCounter(apiName);
          resolve(result);
        } catch (error) {
          this.logger.error(`${apiName} request failed: ${error.message}`);
          reject(error);
        }
      });
    });
  }
  
  // Track daily limits
  async checkDailyLimit(apiName: string): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    const key = `api-limit:${apiName}:${today}`;
    const count = await this.redis.get(key);
    
    const limits = {
      'football-data': Infinity,
      'open-meteo': Infinity,
      'fantasy-pl': Infinity,
      'odds-api': 17,
    };
    
    const currentCount = parseInt(count || '0');
    const limit = limits[apiName] || Infinity;
    
    if (currentCount >= limit) {
      this.logger.warn(`Daily limit reached for ${apiName}: ${currentCount}/${limit}`);
      return false;
    }
    
    return true;
  }
  
  private async incrementDailyCounter(apiName: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const key = `api-limit:${apiName}:${today}`;
    
    await this.redis.incr(key);
    await this.redis.expire(key, 24 * 60 * 60); // Expire after 24 hours
  }
  
  // Get remaining quota
  async getRemainingQuota(apiName: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const key = `api-limit:${apiName}:${today}`;
    const count = await this.redis.get(key);
    
    const limits = {
      'football-data': Infinity,
      'open-meteo': Infinity,
      'fantasy-pl': Infinity,
      'odds-api': 17,
    };
    
    const currentCount = parseInt(count || '0');
    const limit = limits[apiName] || Infinity;
    
    return limit - currentCount;
  }
}
```

### 6. Smart Caching Decorator

```typescript
// src/common/decorators/cacheable.decorator.ts
export function Cacheable(ttlSeconds: number, keyPrefix: string) {
  return function (
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const cacheService = this.cacheService || this.redis;
      
      // Generate cache key
      const argsKey = JSON.stringify(args);
      const cacheKey = `${keyPrefix}:${argsKey}`;
      
      // Check cache
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        console.log(`Cache hit: ${cacheKey}`);
        return JSON.parse(cached);
      }
      
      // Execute original method
      console.log(`Cache miss: ${cacheKey}`);
      const result = await originalMethod.apply(this, args);
      
      // Store in cache
      await cacheService.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        ttlSeconds
      );
      
      return result;
    };
    
    return descriptor;
  };
}

// Usage example
@Injectable()
export class TeamService {
  constructor(private cacheService: CacheService) {}
  
  @Cacheable(3600, 'h2h') // Cache for 1 hour
  async getHeadToHead(team1Id: number, team2Id: number) {
    // Derived from stored matches
    return await this.fixtureService.getHeadToHead(team1Id, team2Id);
  }
  
  @Cacheable(1800, 'team-form') // Cache for 30 minutes
  async getTeamForm(teamId: number, lastNGames: number = 5) {
    // Calculate team form
    return await this.calculateForm(teamId, lastNGames);
  }
}
```

---

## Complete Module Architecture

```
src/
├── app.module.ts
├── main.ts
│
├── config/
│   ├── database.config.ts
│   ├── redis.config.ts
│   ├── apis.config.ts           # All API keys & limits
│   ├── ml.config.ts             # Model paths & versions
│   └── queue.config.ts
│
├── common/
│   ├── decorators/
│   │   ├── cacheable.decorator.ts
│   │   └── rate-limit.decorator.ts
│   ├── filters/
│   │   ├── http-exception.filter.ts
│   │   └── validation-exception.filter.ts
│   ├── guards/
│   │   ├── auth.guard.ts
│   │   └── rate-limit.guard.ts
│   ├── interceptors/
│   │   ├── logging.interceptor.ts
│   │   └── transform.interceptor.ts
│   ├── pipes/
│   │   └── validation.pipe.ts
│   └── services/
│       ├── api-rate-limiter.service.ts
│       └── cache.service.ts
│
│   ├── modules/
│   │   ├── football/
│   │   │   ├── football.module.ts
│   │   │   ├── entities/
│   │   │   │   ├── team.entity.ts
│   │   │   │   ├── fixture.entity.ts
│   │   │   │   ├── standing.entity.ts
│   │   │   │   └── match-statistics.entity.ts
│   │   │   ├── services/
│   │   │   │   ├── football-data-org.service.ts   # PRIMARY - Main data source
│   │   │   │   ├── fantasy-pl.service.ts          # PL injuries & stats
│   │   │   │   ├── weather-api.service.ts         # Weather data
│   │   │   │   ├── statsbomb.service.ts           # Historical xG data
│   │   │   │   ├── data-aggregator.service.ts     # Combines all sources
│   │   │   │   ├── team.service.ts
│   │   │   │   ├── fixture.service.ts
│   │   │   │   └── standing.service.ts
│   │   │   ├── controllers/
│   │   │   │   ├── team.controller.ts
│   │   │   │   ├── fixture.controller.ts
│   │   │   │   └── standing.controller.ts
│   │   │   └── dto/
│   │   │       ├── create-fixture.dto.ts
│   │   │       └── update-team.dto.ts
│   │
│   ├── predictions/
│   │   ├── predictions.module.ts
│   │   ├── entities/
│   │   │   ├── prediction.entity.ts
│   │   │   ├── model-metrics.entity.ts
│   │   │   └── feature-importance.entity.ts
│   │   ├── services/
│   │   │   ├── feature-engineering.service.ts
│   │   │   ├── ml-inference.service.ts        # ONNX runtime
│   │   │   ├── prediction.service.ts
│   │   │   └── confidence-scoring.service.ts
│   │   ├── controllers/
│   │   │   └── prediction.controller.ts
│   │   └── dto/
│   │       └── prediction-response.dto.ts
│   │
│   ├── injuries/
│   │   ├── injuries.module.ts
│   │   ├── entities/
│   │   │   ├── injury.entity.ts
│   │   │   └── injury-impact.entity.ts
│   │   ├── services/
│   │   │   ├── injury.service.ts
│   │   │   ├── injury-scraper.service.ts
│   │   │   └── injury-impact.service.ts
│   │   └── controllers/
│   │       └── injury.controller.ts
│   │
│   ├── data-quality/
│   │   ├── data-quality.module.ts
│   │   └── services/
│   │       ├── data-quality.service.ts
│   │       └── validation.service.ts
│   │
│   ├── ml-monitoring/
│   │   ├── ml-monitoring.module.ts
│   │   ├── entities/
│   │   │   └── model-performance.entity.ts
│   │   ├── services/
│   │   │   ├── model-monitoring.service.ts
│   │   │   ├── drift-detection.service.ts
│   │   │   └── retraining.service.ts
│   │   └── controllers/
│   │       └── monitoring.controller.ts
│   │
│   ├── sync/
│   │   ├── sync.module.ts
│   │   ├── processors/
│   │   │   ├── fixtures-sync.processor.ts
│   │   │   ├── standings-sync.processor.ts
│   │   │   ├── team-stats-sync.processor.ts
│   │   │   ├── injuries-scraper.processor.ts
│   │   │   ├── weather-sync.processor.ts
│   │   │   └── odds-sync.processor.ts
│   │   └── schedules/
│   │       └── sync.schedule.ts
│   │
│   └── analytics/
│       ├── analytics.module.ts
│       ├── services/
│       │   └── analytics.service.ts
│       └── controllers/
│           └── analytics.controller.ts
│
├── ml/                          # Python ML code
│   ├── requirements.txt
│   ├── training/
│   │   ├── train.py
│   │   ├── feature_engineering.py
│   │   ├── hyperparameter_tuning.py
│   │   ├── baseline_models.py
│   │   └── evaluate_model.py
│   ├── models/
│   │   ├── xgboost_v1.onnx
│   │   ├── random_forest_v1.onnx
│   │   ├── poisson_v1.onnx
│   │   ├── logistic_v1.onnx
│   │   └── metadata.json
│   ├── monitoring/
│   │   ├── drift_detection.py
│   │   ├── performance_tracking.py
│   │   └── calibration_check.py
│   └── export/
│       └── export_onnx.py
│
└── database/
    ├── migrations/
    └── seeds/
```

---

## Core Entities

### Fixture Entity

```typescript
@Entity('fixtures')
export class Fixture {
  @PrimaryColumn()
  id: number;
  
  @Column()
  homeTeamId: number;
  
  @Column()
  awayTeamId: number;
  
  @Column()
  leagueCode: string;  // PL, PD, BL1, SA, FL1
  
  @Column({ type: 'timestamp' })
  kickoff: Date;
  
  @Column({ nullable: true })
  homeGoals: number;
  
  @Column({ nullable: true })
  awayGoals: number;
  
  @Column({ type: 'enum', enum: ['SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED'] })
  status: string;
  
  @Column({ nullable: true })
  venue: string;
  
  @Column({ nullable: true })
  referee: string;
  
  @Column({ type: 'timestamp' })
  createdAt: Date;
  
  @Column({ type: 'timestamp' })
  updatedAt: Date;
  
  @ManyToOne(() => Team)
  @JoinColumn({ name: 'homeTeamId' })
  homeTeam: Team;
  
  @ManyToOne(() => Team)
  @JoinColumn({ name: 'awayTeamId' })
  awayTeam: Team;
  
  @OneToMany(() => Prediction, prediction => prediction.fixture)
  predictions: Prediction[];
}
```

### Prediction Entity (Enhanced)

```typescript
@Entity('predictions')
export class Prediction {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  fixtureId: number;
  
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  homeWinProb: number;
  
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  drawProb: number;
  
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  awayWinProb: number;
  
  @Column({ type: 'enum', enum: ['HOME', 'DRAW', 'AWAY'] })
  predictedOutcome: string;
  
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  confidence: number;
  
  @Column({ type: 'jsonb' })
  confidenceBreakdown: {
    dataQuality: number;
    modelCertainty: number;
    historicalAccuracy: number;
    contextualFactors: number;
  };
  
  @Column({ type: 'jsonb' })
  features: object;  // All features used for this prediction
  
  @Column()
  modelVersion: string;
  
  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  predictedHomeGoals: number;
  
  @Column({ type: 'decimal', precision: 3, scale: 2, nullable: true })
  predictedAwayGoals: number;
  
  @Column({ type: 'timestamp' })
  createdAt: Date;
  
  @ManyToOne(() => Fixture, fixture => fixture.predictions)
  @JoinColumn({ name: 'fixtureId' })
  fixture: Fixture;
  
  @OneToOne(() => PredictionResult)
  result: PredictionResult;
}
```

### Model Metrics Entity

```typescript
@Entity('model_metrics')
export class ModelMetrics {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  modelVersion: string;
  
  @Column({ type: 'date' })
  date: Date;
  
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  accuracy: number;
  
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  brierScore: number;
  
  @Column({ type: 'decimal', precision: 5, scale: 4, nullable: true })
  roi: number;
  
  @Column({ type: 'jsonb' })
  confusionMatrix: {
    home: { predicted: number; actual: number };
    draw: { predicted: number; actual: number };
    away: { predicted: number; actual: number };
  };
  
  @Column({ type: 'jsonb' })
  calibration: {
    lowConfidence: { predicted: number; actual: number };
    mediumConfidence: { predicted: number; actual: number };
    highConfidence: { predicted: number; actual: number };
  };
  
  @Column()
  totalPredictions: number;
  
  @Column({ type: 'timestamp' })
  createdAt: Date;
}
```

### Injury Impact Entity

```typescript
@Entity('injury_impact')
export class InjuryImpact {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  playerId: number;
  
  @Column()
  teamId: number;
  
  @Column()
  playerName: string;
  
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  playerImportance: number; // 0-100
  
  @Column({ type: 'enum', enum: ['GK', 'DEF', 'MID', 'FWD'] })
  positionCriticality: string;
  
  @Column({ type: 'jsonb' })
  playerStats: {
    minutesPlayed: number;
    goals: number;
    assists: number;
    cleanSheets?: number;
    rating: number;
  };
  
  @Column({ type: 'jsonb' })
  teamPerformanceWithout: {
    matchesPlayed: number;
    winRate: number;
    goalsPerGame: number;
    goalsConcededPerGame: number;
    pointsPerGame: number;
  };
  
  @Column({ type: 'decimal', precision: 5, scale: 2 })
  impactScore: number; // 0-10
  
  @Column({ type: 'enum', enum: ['OUT', 'DOUBTFUL', 'RECOVERING'] })
  injuryStatus: string;
  
  @Column({ type: 'date', nullable: true })
  expectedReturn: Date;
  
  @Column({ type: 'timestamp' })
  lastUpdated: Date;
  
  @ManyToOne(() => Team)
  @JoinColumn({ name: 'teamId' })
  team: Team;
}
```

### Feature Importance Entity

```typescript
@Entity('feature_importance')
export class FeatureImportance {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column()
  modelVersion: string;
  
  @Column()
  featureName: string;
  
  @Column({ type: 'decimal', precision: 5, scale: 4 })
  importance: number;
  
  @Column()
  category: string; // 'form', 'strength', 'h2h', etc.
  
  @Column({ type: 'timestamp' })
  calculatedAt: Date;
}
```

---

## Essential Services

### Feature Engineering Service

```typescript
// src/modules/predictions/services/feature-engineering.service.ts
@Injectable()
export class FeatureEngineeringService {
  
  async extractFeatures(fixtureId: number): Promise<MatchFeatures> {
    const fixture = await this.fixtureService.findOne(fixtureId);
    
    // Extract all 30 features
    const features: MatchFeatures = {
      // Form features (6)
      homeLastFiveResults: await this.getLastNResults(fixture.homeTeamId, 5, true),
      awayLastFiveResults: await this.getLastNResults(fixture.awayTeamId, 5, false),
      homeGoalsLast5: await this.getGoalsScored(fixture.homeTeamId, 5, true),
      awayGoalsLast5: await this.getGoalsScored(fixture.awayTeamId, 5, false),
      homePointsPerGameHome: await this.getPointsPerGame(fixture.homeTeamId, true),
      awayPointsPerGameAway: await this.getPointsPerGame(fixture.awayTeamId, false),
      
      // Strength features (5)
      homeLeaguePosition: await this.getLeaguePosition(fixture.homeTeamId),
      awayLeaguePosition: await this.getLeaguePosition(fixture.awayTeamId),
      homeGoalDifference: await this.getGoalDifference(fixture.homeTeamId),
      awayGoalDifference: await this.getGoalDifference(fixture.awayTeamId),
      homeExpectedGoals: await this.getExpectedGoals(fixture.homeTeamId),
      awayExpectedGoals: await this.getExpectedGoals(fixture.awayTeamId),
      
      // H2H features (3)
      h2hLast5: await this.getH2H(fixture.homeTeamId, fixture.awayTeamId, 5),
      homeH2HWins: await this.getH2HWins(fixture.homeTeamId, fixture.awayTeamId),
      h2hTotalGoalsAvg: await this.getH2HGoalsAvg(fixture.homeTeamId, fixture.awayTeamId),
      
      // Context features (3)
      homeAdvantage: 1.0, // Standard home advantage
      daysSinceLastMatchHome: await this.getDaysSinceLastMatch(fixture.homeTeamId, fixture.kickoff),
      daysSinceLastMatchAway: await this.getDaysSinceLastMatch(fixture.awayTeamId, fixture.kickoff),
      
      // Injury features (4)
      homeInjuriesCount: await this.getInjuryCount(fixture.homeTeamId),
      awayInjuriesCount: await this.getInjuryCount(fixture.awayTeamId),
      homeInjuryImpact: await this.getInjuryImpact(fixture.homeTeamId),
      awayInjuryImpact: await this.getInjuryImpact(fixture.awayTeamId),
      
      // Momentum features (4)
      homeWinStreak: await this.getWinStreak(fixture.homeTeamId),
      awayWinStreak: await this.getWinStreak(fixture.awayTeamId),
      homeUnbeatenStreak: await this.getUnbeatenStreak(fixture.homeTeamId),
      awayUnbeatenStreak: await this.getUnbeatenStreak(fixture.awayTeamId),
      
      // Managerial features (2) - NEW
      homeManagerTenure: await this.getManagerTenure(fixture.homeTeamId),
      awayManagerTenure: await this.getManagerTenure(fixture.awayTeamId),
      
      // Environmental features (2) - NEW
      weather: await this.getWeather(fixture.venue, fixture.kickoff),
      temperature: await this.getTemperature(fixture.venue, fixture.kickoff),
      
      // Market feature (1) - NEW
      marketOdds: await this.getMarketOdds(fixtureId),
      
      // Metadata
      lastUpdated: Date.now(),
      fixtureId,
      league: fixture.leagueCode,
    };
    
    return features;
  }
  
  private async getExpectedGoals(teamId: number): Promise<number> {
    // Calculate xG based on shot quality over last 10 matches
    const matches = await this.getRecentMatches(teamId, 10);
    // Implementation details...
    return 1.5; // Placeholder
  }
  
  private async getManagerTenure(teamId: number): Promise<number> {
    // Get number of games under current manager
    // Implementation details...
    return 20; // Placeholder
  }
  
  private async getWeather(venue: string, kickoffTime: Date): Promise<any> {
    return await this.weatherService.getWeatherForMatch(venue, kickoffTime);
  }
  
  private async getMarketOdds(fixtureId: number): Promise<any> {
    return await this.oddsService.getOdds(fixtureId);
  }
}
```

---

## Data Sync Strategy

### Updated Strategy with football-data.org (10 req/min budget)

| Data | Source | Frequency | Cron | Requests | Priority | Notes |
|------|--------|-----------|------|----------|----------|-------|
| **Fixtures** | football-data.org | 2x daily | `0 7,19 * * *` | 10 (5 leagues × 2) | High | Next 14 days |
| **Standings** | football-data.org | Daily (Mon-Fri) | `0 2 * * 1-5` | 5 (one per league) | High | League tables |
| **Team Stats** | Internal (from fixtures) | 2x weekly | `0 3 * * 1,4` | 0 | Medium | Derived aggregates |
| **H2H / Recent Form** | Internal (from fixtures) | On demand | Cached 7 days | 0 | Medium | From stored matches |
| **Injuries** | Fantasy PL + Manual (non-PL) | 2x daily | `0 7,19 * * *` | 0 | High | PL only + manual |
| **Live Scores** | football-data.org | Match days only | `*/15 * * * *` during matches | 10-15 | Medium | Status polling within rate limit |
| **Weather** | Open-Meteo | Daily | `0 10 * * *` | 10-15 | Low | Free tier |
| **Predictions** | Internal | Daily | `0 4 * * *` | 0 | High | Generate from cached data |
| **Model Metrics** | After match | Event-driven | Real-time | 0 | High | Track accuracy |

**Request Budget**: Keep football-data.org calls within 10 req/min (use 6s pacing + caching).

### Request Optimization Strategies

```typescript
// 1. Stagger per-league requests with pacing
async syncAllLeaguesFixtures() {
  const leagues = ['PL', 'PD', 'BL1', 'SA', 'FL1'];
  const dateFrom = new Date().toISOString().split('T')[0];
  const dateTo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const results = [];
  
  for (const code of leagues) {
    const matches = await this.footballDataOrg.getCompetitionMatches(code, {
      dateFrom,
      dateTo,
    });
    results.push(...matches);
    await this.delay(6000); // 10 req/min pacing
  }
  
  return results;
}

// 2. Cache aggressively
@Cacheable(43200, 'standings') // 12 hours
async getStandings(leagueCode: string) {
  return this.footballDataOrg.getStandings(leagueCode);
}

// 3. Skip requests on non-match days
async shouldSyncLiveScores(): Promise<boolean> {
  const today = new Date().getDay();
  // Most matches are Sat(6), Sun(0), Wed(3), Thu(4)
  return [0, 3, 4, 6].includes(today);
}
```

---

## API Endpoints

### Fixtures

| Method | Endpoint | Description | Cache |
|--------|----------|-------------|-------|
| `GET` | `/api/fixtures` | Upcoming fixtures (filterable by league) | 30 min |
| `GET` | `/api/fixtures/:id` | Single fixture details | 1 hour |
| `GET` | `/api/fixtures/today` | Today's fixtures | 15 min |
| `GET` | `/api/fixtures/league/:code` | Fixtures by league | 30 min |

### Predictions

| Method | Endpoint | Description | Cache |
|--------|----------|-------------|-------|
| `GET` | `/api/predictions/:fixtureId` | AI prediction for match | 1 hour |
| `GET` | `/api/predictions/today` | All predictions for today | 30 min |
| `GET` | `/api/predictions/upcoming` | Next 7 days predictions | 1 hour |
| `GET` | `/api/predictions/accuracy` | Model performance stats | 1 day |
| `POST` | `/api/predictions/generate` | Generate prediction on demand | None |

### Teams

| Method | Endpoint | Description | Cache |
|--------|----------|-------------|-------|
| `GET` | `/api/teams/:id` | Team details | 1 day |
| `GET` | `/api/teams/:id/form` | Team form (last N games) | 6 hours |
| `GET` | `/api/teams/:id/injuries` | Current injuries | 6 hours |
| `GET` | `/api/teams/:id/statistics` | Season statistics | 12 hours |

### Standings

| Method | Endpoint | Description | Cache |
|--------|----------|-------------|-------|
| `GET` | `/api/standings/:leagueCode` | League table | 6 hours |

### Analytics

| Method | Endpoint | Description | Cache |
|--------|----------|-------------|-------|
| `GET` | `/api/analytics/model-performance` | Model metrics over time | 1 hour |
| `GET` | `/api/analytics/feature-importance` | Top features | 1 day |
| `GET` | `/api/analytics/calibration` | Probability calibration | 1 day |
| `GET` | `/api/analytics/trends` | Prediction trends | 6 hours |

### Admin

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/admin/sync-data` | Trigger manual sync | Required |
| `POST` | `/api/admin/train-model` | Trigger model retraining | Required |
| `GET` | `/api/admin/system-health` | System health check | Required |
| `GET` | `/api/admin/api-quotas` | Check API quotas | Required |

---

## Background Jobs & Scheduling

```typescript
// src/modules/sync/schedules/sync.schedule.ts
@Injectable()
export class SyncSchedule {
  constructor(
    private fixturesSyncProcessor: FixturesSyncProcessor,
    private standingsSyncProcessor: StandingsSyncProcessor,
    private injuriesScraperProcessor: InjuriesScraperProcessor,
    private weatherSyncProcessor: WeatherSyncProcessor,
    private predictionService: PredictionService,
    private modelMonitoringService: ModelMonitoringService,
    private modelTrainingProcessor: ModelTrainingProcessor,
    private footballDataOrgService: FootballDataOrgService,
  ) {}
  
  // Twice daily at 7 AM and 7 PM - update fixtures
  @Cron('0 7,19 * * *')
  async syncFixtures() {
    this.logger.log('Starting fixtures sync from football-data.org');
    await this.fixturesSyncProcessor.process();
  }
  
  // Every Monday-Friday at 2 AM - update standings (after matches)
  @Cron('0 2 * * 1-5')
  async syncStandings() {
    this.logger.log('Starting standings sync from football-data.org');
    await this.standingsSyncProcessor.process();
  }
  
  // Twice daily at 7 AM and 7 PM - sync injuries
  @Cron('0 7,19 * * *')
  async syncInjuries() {
    this.logger.log('Starting injuries sync from Fantasy PL + manual entry');
    await this.injuriesScraperProcessor.process();
  }
  
  // Every day at 10 AM - fetch weather for upcoming matches
  @Cron('0 10 * * *')
  async syncWeather() {
    this.logger.log('Starting weather sync');
    await this.weatherSyncProcessor.process();
  }
  
  // Every day at 4 AM - generate predictions for next 7 days
  @Cron('0 4 * * *')
  async generateUpcomingPredictions() {
    this.logger.log('Generating predictions for upcoming matches');
    const fixtures = await this.fixtureService.getUpcoming(7);
    
    for (const fixture of fixtures) {
      try {
        await this.predictionService.generatePrediction(fixture.id);
      } catch (error) {
        this.logger.error(`Failed to generate prediction for fixture ${fixture.id}: ${error.message}`);
      }
    }
  }
  
  // Every day at 3 AM - check if model needs retraining
  @Cron('0 3 * * *')
  async checkModelRetrain() {
    this.logger.log('Checking if model needs retraining');
    const driftStatus = await this.modelMonitoringService.checkModelDrift();
    
    if (driftStatus.isDrifting) {
      this.logger.warn('Model drift detected - scheduling retraining');
      await this.modelTrainingProcessor.scheduleRetrain();
    }
  }
  
  // Every 15 minutes during match days - check live scores
  @Cron('*/15 * * * *')
  async syncLiveScores() {
    const shouldSync = await this.shouldSyncLiveScores();
    if (!shouldSync) return;
    
    this.logger.log('Syncing live scores');
    const liveFixtures = await this.footballDataOrgService.getLiveMatches();
    await this.fixtureService.updateLiveScores(liveFixtures);
  }
  
  // Helper: Check if today is a match day
  private async shouldSyncLiveScores(): Promise<boolean> {
    const today = new Date().getDay();
    // Most matches: Sat(6), Sun(0), Wed(3), Thu(4), Tue(2)
    return [0, 2, 3, 4, 6].includes(today);
  }
  
  // Every hour - clean up old cache entries
  @Cron('0 * * * *')
  async cleanupCache() {
    await this.cacheService.cleanup();
  }
  
  // Event-driven: After each match finishes
  @OnEvent('match.finished')
  async onMatchFinished(event: MatchFinishedEvent) {
    this.logger.log(`Match ${event.fixtureId} finished - updating metrics`);
    
    // Update model metrics
    const prediction = await this.predictionService.findByFixture(event.fixtureId);
    if (prediction) {
      await this.modelMonitoringService.trackAccuracy(prediction, event.result);
    }
    
    // Update team form
    await this.teamService.recalculateForm(event.homeTeamId);
    await this.teamService.recalculateForm(event.awayTeamId);
  }
}
```
  }
  
  // Every day at 3 AM - check if model needs retraining
  @Cron('0 3 * * *')
  async checkModelRetrain() {
    this.logger.log('Checking if model needs retraining');
    const driftStatus = await this.modelMonitoringService.checkModelDrift();
    
    if (driftStatus.isDrifting) {
      this.logger.warn('Model drift detected - scheduling retraining');
      await this.modelTrainingProcessor.scheduleRetrain();
    }
  }
  
  // Every hour - clean up old cache entries
  @Cron('0 * * * *')
  async cleanupCache() {
    await this.cacheService.cleanup();
  }
  
  // Event-driven: After each match finishes
  @OnEvent('match.finished')
  async onMatchFinished(event: MatchFinishedEvent) {
    this.logger.log(`Match ${event.fixtureId} finished - updating metrics`);
    
    // Update model metrics
    const prediction = await this.predictionService.findByFixture(event.fixtureId);
    if (prediction) {
      await this.modelMonitoringService.trackAccuracy(prediction, event.result);
    }
    
    // Update team form
    await this.teamService.recalculateForm(event.homeTeamId);
    await this.teamService.recalculateForm(event.awayTeamId);
  }
}
```

---

## Testing Strategy

### Unit Tests

```typescript
// tests/unit/prediction.service.spec.ts
describe('PredictionService', () => {
  let service: PredictionService;
  let mlInferenceService: MockType<MLInferenceService>;
  let featureEngineeringService: MockType<FeatureEngineeringService>;
  
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PredictionService,
        {
          provide: MLInferenceService,
          useFactory: mockMLInferenceService,
        },
        {
          provide: FeatureEngineeringService,
          useFactory: mockFeatureEngineeringService,
        },
      ],
    }).compile();
    
    service = module.get(PredictionService);
  });
  
  it('should generate valid prediction probabilities', async () => {
    const fixtureId = 1;
    const prediction = await service.generatePrediction(fixtureId);
    
    expect(prediction.homeWinProb).toBeGreaterThan(0);
    expect(prediction.homeWinProb).toBeLessThan(1);
    expect(prediction.homeWinProb + prediction.drawProb + prediction.awayWinProb).toBeCloseTo(1.0, 2);
  });
  
  it('should have confidence score between 0 and 1', async () => {
    const prediction = await service.generatePrediction(1);
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.confidence).toBeLessThanOrEqual(1);
  });
});
```

### Integration Tests

```typescript
// tests/integration/prediction.e2e-spec.ts
describe('Prediction Integration Tests (e2e)', () => {
  let app: INestApplication;
  
  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    
    app = moduleFixture.createNestApplication();
    await app.init();
  });
  
  it('/api/predictions/:fixtureId (GET) - should return prediction', () => {
    return request(app.getHttpServer())
      .get('/api/predictions/1')
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveProperty('homeWinProb');
        expect(res.body).toHaveProperty('confidence');
        expect(res.body.confidence).toBeGreaterThan(0);
      });
  });
  
  it('should reduce confidence when injury data is missing', async () => {
    // Create fixture with missing injury data
    const fixtureWithInjuries = await createTestFixture({ hasInjuryData: true });
    const fixtureWithoutInjuries = await createTestFixture({ hasInjuryData: false });
    
    const pred1 = await request(app.getHttpServer()).get(`/api/predictions/${fixtureWithInjuries.id}`);
    const pred2 = await request(app.getHttpServer()).get(`/api/predictions/${fixtureWithoutInjuries.id}`);
    
    expect(pred1.body.confidence).toBeGreaterThan(pred2.body.confidence);
  });
  
  it('should handle API rate limit gracefully', async () => {
    // Simulate rate limit
    const requests = Array.from({ length: 15 }, (_, i) => 
      request(app.getHttpServer()).get('/api/fixtures')
    );
    
    const responses = await Promise.all(requests);
    const rateLimitedResponses = responses.filter(r => r.status === 429);
    
    expect(rateLimitedResponses.length).toBeGreaterThan(0);
  });
});
```

### Model Testing

```python
# ml/tests/test_model.py
import pytest
import numpy as np
from training.train import train_model
from training.evaluate_model import evaluate_model

def test_model_accuracy():
    """Test that model achieves minimum accuracy threshold"""
    X_train, y_train, X_test, y_test = load_test_data()
    
    model = train_model(X_train, y_train)
    accuracy = evaluate_model(model, X_test, y_test)
    
    assert accuracy > 0.45, f"Model accuracy {accuracy} below threshold"

def test_prediction_probabilities_sum_to_one():
    """Test that predicted probabilities sum to 1.0"""
    model = load_trained_model()
    X_test = load_test_features()
    
    predictions = model.predict_proba(X_test)
    
    for pred in predictions:
        assert np.isclose(pred.sum(), 1.0, atol=0.01)

def test_feature_importance():
    """Test that key features have non-zero importance"""
    model = load_trained_model()
    feature_names = get_feature_names()
    importance = model.feature_importances_
    
    important_features = ['homeForm', 'awayForm', 'h2hLast5']
    
    for feature in important_features:
        idx = feature_names.index(feature)
        assert importance[idx] > 0, f"{feature} has zero importance"
```

---

## Implementation Phases

### Phase 1: Foundation (Weeks 1-2)

**Goals**: Set up basic infrastructure and data collection

- [x] NestJS project setup with TypeORM + PostgreSQL
- [x] Redis configuration for caching
- [x] Football-Data.org integration
- [x] Core entities (Team, Fixture, Standing)
- [x] Basic sync jobs (fixtures, standings)
- [x] API endpoints for fixtures and teams
- [x] Unit tests for services

**Deliverables**:
- Working API that fetches and stores fixture data
- Basic team and standing information
- Automated daily sync jobs

### Phase 2: Data Pipeline (Weeks 3-4)

**Goals**: Build comprehensive data collection system

- [x] Multi-API aggregation service
- [ ] API rate limiter implementation
- [x] Redis caching layer with TTL strategy
- [x] Injury data collection (FPL API - PL only)
- [x] Weather API integration
- [ ] Odds API integration
- [x] Data quality validation service
- [x] Feature engineering service (basic)

**Deliverables**:
- Complete data aggregation from all sources
- Validated data pipeline
- Basic feature extraction working

### Phase 3: ML Model Development (Weeks 5-6)

**Goals**: Build and train prediction models

- [ ] Collect 2+ seasons of historical data
- [x] Feature extraction pipeline (Python)
- [x] Train baseline model (Logistic Regression)
- [x] Train XGBoost model
- [x] Train Random Forest model
- [ ] Train Poisson Regression model
- [x] Model evaluation and comparison
- [x] Export to ONNX format
- [x] Hyperparameter tuning

**Deliverables**:
- Trained models with >45% accuracy
- ONNX model files
- Model evaluation report

### Phase 4: ML Integration (Weeks 7-8)

**Goals**: Integrate models into NestJS backend

- [x] ONNX Runtime integration in NestJS
- [x] ML inference service
- [x] Prediction service with ensemble
- [x] Confidence scoring system
- [x] Prediction API endpoints
- [x] Model monitoring service
- [x] Drift detection system
- [x] Accuracy tracking (basic)

**Deliverables**:
- Working prediction API
- Real-time predictions with confidence scores
- Model performance dashboard

### Phase 5: Enhancement & Optimization (Weeks 9-10)

**Goals**: Improve accuracy and add advanced features

- [x] Enhanced injury impact scoring
- [ ] Manager tenure tracking (dropped)
- [x] Advanced feature engineering
- [ ] Model retraining pipeline
- [ ] A/B testing framework
- [ ] Performance optimization
- [ ] Comprehensive integration tests

**Deliverables**:
- Improved prediction accuracy
- Automated retraining
- Full test coverage

### Phase 6: Production Ready (Weeks 11-12)

**Goals**: Prepare for deployment

- [ ] Load testing
- [ ] Error handling and logging
- [ ] Monitoring and alerting setup
- [ ] Documentation (API, deployment)
- [ ] CI/CD pipeline
- [ ] Database backup strategy
- [ ] Security audit

**Deliverables**:
- Production-ready application
- Complete documentation
- Deployment guide

---

## Tech Stack Summary

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Framework** | NestJS | Backend API framework |
| **Language** | TypeScript | Type-safe development |
| **Database** | PostgreSQL | Primary data store |
| **ORM** | TypeORM | Database abstraction |
| **Cache** | Redis | Caching & sessions |
| **Queue** | Bull (Redis-based) | Background job processing |
| **ML Training** | Python 3.10+ | Model training |
| **ML Libraries** | XGBoost, scikit-learn, TensorFlow | Model development |
| **ML Inference** | ONNX Runtime (Node.js) | Fast inference in Node |
| **Web Scraping** | Cheerio / Puppeteer | Data collection |
| **Scheduler** | @nestjs/schedule + Cron | Job scheduling |
| **Validation** | class-validator | Input validation |
| **Testing** | Jest, Supertest | Unit & integration tests |
| **Logging** | Winston | Application logging |
| **Monitoring** | Prometheus + Grafana | Metrics & visualization |
| **API Docs** | Swagger / OpenAPI | API documentation |

---

## Monitoring & Observability

### Metrics to Track

**Application Metrics**:
- API response times (p50, p95, p99)
- Request rate (requests/second)
- Error rate
- Cache hit/miss ratio
- Queue job processing time

**ML Metrics**:
- Prediction accuracy (daily, weekly, monthly)
- Brier score (probability calibration)
- Confidence distribution
- Feature importance changes
- Model drift indicators

**Data Metrics**:
- Data freshness (time since last update)
- API quota usage
- Failed API requests
- Missing data rate
- Data quality score

### Alerting Rules

```typescript
// Alert if accuracy drops below 45%
if (dailyAccuracy < 0.45) {
  alert('HIGH', 'Model accuracy below threshold');
}

// Alert if API quota exhausted
if (apiQuotaRemaining < 10) {
  alert('MEDIUM', 'API quota running low');
}

// Alert if data sync fails
if (syncJobFailed) {
  alert('HIGH', 'Data sync job failed');
}

// Alert if predictions are stale
if (predictionAge > 24 * 60 * 60 * 1000) {
  alert('MEDIUM', 'Predictions not updated in 24h');
}
```

---

## Cost Breakdown: $0

| Service | Solution | Free Tier Limits | Cost |
|---------|----------|------------------|------|
| **Football Data** | football-data.org v4 (primary) | 10 req/min | $0 |
| **Player Stats** | Fantasy Premier League API | Unlimited | $0 |
| **Weather Data** | Open-Meteo | Unlimited | $0 |
| **Historical xG** | StatsBomb Open Data | Unlimited (GitHub) | $0 |
| **Database** | PostgreSQL (local) or Supabase free tier (500MB) | 500MB | $0 |
| **Cache** | Redis (local) or Upstash free tier (10K commands/day) | 10K/day | $0 |
| **Hosting** | Local dev / Railway free tier (500 hrs/month) | 500 hrs/month | $0 |
| **Monitoring** | Prometheus + Grafana (self-hosted) | Unlimited | $0 |

**Total Monthly Cost**: $0

### Why This is Sustainable

- football-data.org free tier with pacing (10 req/min)
- Smart caching reduces API calls by 70-80%
- Staggered per-league syncs keep within limits
- Off-peak syncs reduce load
- Local development avoids production costs

### Upgrade Path (When Ready to Scale)

If you outgrow the free tier, move to football-data.org paid tiers for higher rate limits and broader coverage.

---

## Security Considerations

1. **API Keys**: Store in environment variables, never commit
2. **Rate Limiting**: Implement per-IP rate limiting
3. **Input Validation**: Validate all user inputs
4. **SQL Injection**: Use parameterized queries (TypeORM handles this)
5. **CORS**: Configure allowed origins
6. **Authentication**: JWT for protected endpoints
7. **Secrets Management**: Use dotenv or HashiCorp Vault
8. **HTTPS**: Enforce HTTPS in production
9. **Helmet.js**: Security headers
10. **Dependency Scanning**: Regular npm audit

---

## Future Enhancements

**Phase 2 Features** (Post-MVP):
- [ ] Live match tracking with real-time updates
- [ ] Player-level predictions (goalscorer, assists)
- [ ] Betting strategy simulator
- [ ] Mobile app (React Native)
- [ ] User accounts and personalized predictions
- [ ] Social features (predictions sharing)
- [ ] More leagues (Championship, European competitions)
- [ ] Advanced visualizations (prediction trends, form charts)
- [ ] Email/SMS alerts for high-confidence predictions
- [ ] Integration with betting platforms (disclaimer: for info only)

**ML Improvements**:
- [ ] Deep learning models (LSTM for time-series)
- [ ] Transfer learning across leagues
- [ ] Automated feature selection
- [ ] Online learning (update model in real-time)
- [ ] Explainable AI (SHAP values for predictions)

---

## Resources & References

### APIs (Primary)
- **[football-data.org v4 Documentation](football-data-org-v4-complete-documentation.md)** - Primary data source
- **[football-data.org Account](https://www.football-data.org/client/register)** - Manage your API key
- [Fantasy Premier League API](https://fantasy.premierleague.com/api/bootstrap-static/) - Free PL injuries
- [Open-Meteo API](https://open-meteo.com/) - Weather data
- [StatsBomb Open Data](https://github.com/statsbomb/open-data) - Historical xG data

### football-data.org Resources
- **[football-data.org v4 Documentation](football-data-org-v4-complete-documentation.md)** - Endpoints and examples
- **[football-data.org Website](https://www.football-data.org/)** - Updates and account management

### ML Resources
- [XGBoost Documentation](https://xgboost.readthedocs.io/)
- [ONNX Runtime Node.js](https://onnxruntime.ai/docs/get-started/with-javascript.html)
- [scikit-learn](https://scikit-learn.org/)
- [Poisson Distribution for Football](https://www.pinnacle.com/en/betting-articles/Soccer/how-to-calculate-poisson-distribution/)

### NestJS Resources
- [NestJS Documentation](https://docs.nestjs.com/)
- [TypeORM Documentation](https://typeorm.io/)
- [Bull Queue](https://docs.bullmq.io/)
- [NestJS Schedule](https://docs.nestjs.com/techniques/task-scheduling)

### Football Analytics
- [StatsBomb Articles](https://statsbomb.com/articles/) - Advanced analytics
- [Football xG Explained](https://theanalyst.com/na/2021/07/what-are-expected-goals-xg/)
- [Betting Odds Explained](https://help.smarkets.com/hc/en-gb/articles/214058369-How-to-calculate-implied-probability-in-betting)

---

## Conclusion

This comprehensive plan provides a complete roadmap for building a sophisticated football prediction system using AI/ML with **football-data.org as the primary data source**. The architecture is designed to be:

- **Scalable**: Can handle multiple leagues and thousands of predictions
- **Maintainable**: Clear module separation and coding standards
- **Accurate**: Advanced ML models with continuous monitoring
- **Cost-effective**: Free-tier APIs with football-data.org (10 req/min pacing)
- **Production-ready**: Includes testing, monitoring, and deployment strategies
- **Reliable**: football-data.org with caching + retries and fallback data

The phased implementation approach ensures you can build incrementally, validating each component before moving to the next. Start with the foundation, get data flowing, then add ML capabilities, and finally optimize for production.

**Key Success Factors**:
1. **Data quality is paramount** - invest time in validation and the Data Quality Service
2. **Start simple** - baseline models (Logistic Regression) before complex (XGBoost)
3. **Monitor everything** - you can't improve what you don't measure
4. **Retrain regularly** - leagues evolve, models drift
5. **Be realistic about accuracy** - 50-55% is excellent for football predictions
6. **Manage API quota wisely** - 10 req/min requires pacing, caching, and batching

### Quick Start Checklist

Before you begin coding:

- [ ] Sign up for football-data.org at https://www.football-data.org/
- [ ] Get your API key from your account
- [ ] Test football-data.org with a sample request
- [ ] Set up local PostgreSQL database
- [ ] Set up local Redis instance
- [ ] Clone or create NestJS project structure
- [ ] Configure environment variables (.env)
- [ ] Install dependencies (npm install)
- [ ] Run a quick football-data.org request to verify connection
- [ ] Review the football-data.org Integration Guide section above
- [ ] Proceed with Phase 1 implementation

### Why football-data.org?

We use football-data.org because:

- Free tier fits within 10 req/min with pacing
- Current-season coverage for the top leagues
- Simple, stable endpoints for fixtures, teams, standings
- Works well with caching and retry logic
- Pairs cleanly with FPL + manual injury inputs

Good luck with your build! 🚀⚽

---

**Need help?** Check the [football-data.org documentation](football-data-org-v4-complete-documentation.md) or the [football-data.org site](https://www.football-data.org/).
