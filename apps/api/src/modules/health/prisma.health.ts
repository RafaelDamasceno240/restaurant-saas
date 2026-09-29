import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

// @nestjs/terminus ships indicators for TypeORM/Mongoose/Sequelize/etc, but
// not for Prisma — this is the standard pattern the Prisma docs recommend
// for Terminus integration: a trivial round-trip query.
@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'Postgres check failed',
        this.getStatus(key, false, { message: (error as Error).message }),
      );
    }
  }
}
