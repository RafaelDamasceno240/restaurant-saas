import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaHealthIndicator } from './prisma.health';
import { RedisHealthIndicator } from './redis.health';

// Deliberately version-neutral: infra probes (Docker/K8s/uptime checks) hit
// /health directly and shouldn't need to know about API versioning.
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Process liveness — no external dependency checks' })
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness — checks PostgreSQL and Redis' })
  ready() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('postgres'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Alias for /health/ready' })
  root() {
    return this.ready();
  }
}
