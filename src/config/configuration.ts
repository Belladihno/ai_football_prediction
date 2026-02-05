export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  apiVersion: process.env.API_VERSION || 'api/v1',

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    name: process.env.DB_NAME || 'football_predictions',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  },

  // football-data.org API Configuration
  footballDataOrg: {
    baseUrl: process.env.FOOTBALL_DATA_BASE_URL || 'https://api.football-data.org/v4',
    apiKey: process.env.FOOTBALL_DATA_API_KEY || '',
  },

  // Odds-API.io Configuration
  oddsApi: {
    baseUrl: process.env.ODDS_API_IO_BASE_URL || 'https://api.odds-api.io/v3',
    apiKey: process.env.ODDS_API_IO_KEY || '',
    bookmakers: process.env.ODDS_API_IO_BOOKMAKERS || 'Bet365,Unibet',
  },

  // API-Football Configuration (legacy)
  rateLimit: {
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  cache: {
    fixtures: 1800,      // 30 minutes
    teams: 86400,        // 24 hours
    standings: 21600,    // 6 hours
    predictions: 3600,   // 1 hour
  },
});
