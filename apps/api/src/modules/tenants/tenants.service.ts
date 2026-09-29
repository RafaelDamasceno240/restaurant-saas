import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  // "Current tenant" only — Phase 01 has no cross-tenant admin surface.
  async findCurrent(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tenant não encontrado.' });
    }
    return tenant;
  }
}
