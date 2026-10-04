import { Global, Inject, Injectable, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../config/configuration';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

// One shared connection for everything that needs Redis at request time (today: the session
// denylist). Commands fail fast instead of piling up: a caller that can live without Redis
// (see SessionRevocationService) must not hold a request for long while Redis is away.
function createClient(config: ConfigService<AppConfig, true>): Redis {
  const logger = new Logger('Redis');
  const client = new Redis(config.get('redis', { infer: true }).url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 1000,
  });
  // ioredis reconnects by itself and emits one error per attempt: log the first of a burst.
  let lastLoggedAt = 0;
  client.on('error', (error: Error) => {
    if (Date.now() - lastLoggedAt > 30_000) {
      lastLoggedAt = Date.now();
      logger.error(`Redis connection error: ${error.message}`);
    }
  });
  return client;
}

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // QUIT waits for the replies in flight; it can only be sent on a live connection.
    if (this.client.status === 'ready') {
      await this.client.quit().catch(() => this.client.disconnect());
    } else {
      this.client.disconnect();
    }
  }
}

@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, inject: [ConfigService], useFactory: createClient },
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
