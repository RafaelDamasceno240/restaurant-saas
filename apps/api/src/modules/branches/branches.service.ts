import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BranchesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForTenant(tenantId: string) {
    return this.prisma.branch.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }

  async findOneForTenant(tenantId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId } });
    if (!branch) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Unidade não encontrada.' });
    }
    return branch;
  }
}
