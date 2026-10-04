import { Injectable, Logger } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  private readonly logger = new Logger(RedisHealthIndicator.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const client = new Redis(this.config.get('redis', { infer: true }).url, {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      client.disconnect();
      if (pong !== 'PONG') {
        throw new Error(`unexpected PING reply: ${pong}`);
      }
      return this.getStatus(key, true);
    } catch (error) {
      client.disconnect();
      // Same rule as the Postgres check: the cause is logged, never returned.
      this.logger.error(`Redis check failed: ${(error as Error).message}`);
      throw new HealthCheckError('Redis check failed', this.getStatus(key, false));
    }
  }
}
