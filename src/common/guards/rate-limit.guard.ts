import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private store: RateLimitStore = {};
  private readonly windowMs: number;
  private readonly maxRequests: number;

  constructor(private configService: ConfigService) {
    this.windowMs = 60 * 1000; // 1 minute
    this.maxRequests = this.configService.get<number>('rateLimit.maxRequests') || 100;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getIp(request);
    const key = `${ip}:${request.path}`;
    const now = Date.now();

    this.cleanup();

    const entry = this.store[key];
    if (!entry || now > entry.resetTime) {
      this.store[key] = {
        count: 1,
        resetTime: now + this.windowMs,
      };
      return true;
    }

    entry.count++;

    if (entry.count > this.maxRequests) {
      throw new ForbiddenException('Too many requests, please try again later');
    }

    return true;
  }

  private getIp(request: Request): string {
    return (
      request.ip ||
      request.socket.remoteAddress?.replace('::ffff:', '') ||
      'unknown'
    );
  }

  private cleanup(): void {
    const now = Date.now();
    Object.keys(this.store).forEach((key) => {
      if (now > this.store[key].resetTime) {
        delete this.store[key];
      }
    });
  }
}
