import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';

jest.mock('ioredis', () => ({ __esModule: true, default: jest.fn() }));

// /health is public. A failing dependency must be reported as "down" and
// nothing more: the driver's message names hosts, ports and users.
describe('health indicators', () => {
  let logged: string[];

  beforeEach(() => {
    logged = [];
    jest.spyOn(Logger.prototype, 'error').mockImplementation((message: unknown) => {
      logged.push(String(message));
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('postgres', () => {
    const driverError = "Can't reach database server at `db.internal.example:5432` for user `saas_admin`";

    it('reports up when the round trip works', async () => {
      const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as PrismaService;
      await expect(new PrismaHealthIndicator(prisma).isHealthy('postgres')).resolves.toEqual({
        postgres: { status: 'up' },
      });
    });

    it('reports down without the driver message, and logs the cause', async () => {
      const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error(driverError)) } as unknown as PrismaService;

      const error = await new PrismaHealthIndicator(prisma).isHealthy('postgres').catch((e) => e);

      expect(error).toBeInstanceOf(HealthCheckError);
      expect(error.causes).toEqual({ postgres: { status: 'down' } });
      expect(error.message).not.toContain('db.internal.example');
      expect(logged.join('\n')).toContain('db.internal.example');
    });
  });

  describe('redis', () => {
    const config = { get: () => ({ url: 'redis://cache.internal.example:6379' }) } as unknown as ConfigService<
      AppConfig,
      true
    >;

    function redisClient(client: { connect: jest.Mock; ping: jest.Mock }) {
      const disconnect = jest.fn();
      (Redis as unknown as jest.Mock).mockImplementation(() => ({ ...client, disconnect }));
      return disconnect;
    }

    it('reports up on PONG and closes the connection', async () => {
      const disconnect = redisClient({ connect: jest.fn().mockResolvedValue(undefined), ping: jest.fn().mockResolvedValue('PONG') });

      await expect(new RedisHealthIndicator(config).isHealthy('redis')).resolves.toEqual({ redis: { status: 'up' } });
      expect(disconnect).toHaveBeenCalled();
    });

    it('reports down without the connection error, logs the cause and closes the connection', async () => {
      const disconnect = redisClient({
        connect: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:6379')),
        ping: jest.fn(),
      });

      const error = await new RedisHealthIndicator(config).isHealthy('redis').catch((e) => e);

      expect(error).toBeInstanceOf(HealthCheckError);
      expect(error.causes).toEqual({ redis: { status: 'down' } });
      expect(logged.join('\n')).toContain('ECONNREFUSED 10.0.0.5:6379');
      expect(disconnect).toHaveBeenCalled();
    });

    it('reports down when the server answers something other than PONG', async () => {
      redisClient({ connect: jest.fn().mockResolvedValue(undefined), ping: jest.fn().mockResolvedValue('LOADING') });

      const error = await new RedisHealthIndicator(config).isHealthy('redis').catch((e) => e);

      expect(error).toBeInstanceOf(HealthCheckError);
      expect(error.causes).toEqual({ redis: { status: 'down' } });
    });
  });
});
