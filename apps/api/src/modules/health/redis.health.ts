import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
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
      const isHealthy = pong === 'PONG';
      client.disconnect();
      if (!isHealthy) {
        throw new HealthCheckError('Redis check failed', this.getStatus(key, false));
      }
      return this.getStatus(key, true);
    } catch (error) {
      client.disconnect();
      throw new HealthCheckError('Redis check failed', this.getStatus(key, false, { message: (error as Error).message }));
    }
  }
}
