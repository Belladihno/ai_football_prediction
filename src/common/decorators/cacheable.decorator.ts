import { SetMetadata } from '@nestjs/common';

export const CACHE_KEY_PREFIX = 'cache:prefix';
export const CACHE_TTL = 'cache:ttl';

export const CacheKey = (key: string) => SetMetadata(CACHE_KEY_PREFIX, key);

export const CacheTTL = (ttl: number) => SetMetadata(CACHE_TTL, ttl);
