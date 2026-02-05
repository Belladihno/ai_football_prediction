import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type RateLimitConfig = Record<string, number>;

@Injectable()
export class ApiRateLimiterService {
  private readonly logger = new Logger(ApiRateLimiterService.name);
  private readonly queues = new Map<string, Promise<void>>();
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly minIntervalMs: RateLimitConfig;

  constructor(private configService: ConfigService) {
    const footballDataMs = this.configService.get<number>('rateLimiter.footballDataOrgMinIntervalMs');
    const oddsApiMs = this.configService.get<number>('rateLimiter.oddsApiMinIntervalMs');
    const openWeatherMs = this.configService.get<number>('rateLimiter.openWeatherMinIntervalMs');

    this.minIntervalMs = {
      'football-data-org': footballDataMs ?? 6000, // 10 req/min
      'odds-api-io': oddsApiMs ?? 36000, // ~100 req/hour
      openweather: openWeatherMs ?? 1000,
    };
  }

  async schedule<T>(apiName: string, requestFn: () => Promise<T>): Promise<T> {
    const interval = this.minIntervalMs[apiName] ?? 0;
    const chain = this.queues.get(apiName) ?? Promise.resolve();

    const next = chain
      .catch(() => undefined)
      .then(async () => {
        const now = Date.now();
        const nextAllowed = this.nextAllowedAt.get(apiName) ?? now;
        const waitMs = Math.max(0, nextAllowed - now);
        if (waitMs > 0) {
          await this.delay(waitMs);
        }

        if (interval > 0) {
          this.nextAllowedAt.set(apiName, Date.now() + interval);
        }

        return requestFn();
      });

    this.queues.set(
      apiName,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );

    return next;
  }

  updateInterval(apiName: string, intervalMs: number) {
    this.minIntervalMs[apiName] = intervalMs;
    this.logger.log(`Updated rate limit for ${apiName} to ${intervalMs}ms`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
