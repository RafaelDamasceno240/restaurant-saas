import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Every method takes `tenantId` explicitly and filters by it. Callers MUST
// pass the tenantId taken from the authenticated request (CurrentUser), never
// from a route param or query string — this is what keeps tenant A from ever
// seeing tenant B's users.
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllForTenant(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      include: { userRoles: { include: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.toDto(u));
  }

  async findOneForTenant(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: { userRoles: { include: { role: true } } },
    });
    // Same 404 whether the id doesn't exist at all or belongs to another
    // tenant — never reveal cross-tenant existence.
    if (!user) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
    }
    return this.toDto(user);
  }

  private toDto(user: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    status: string;
    lastLoginAt: Date | null;
    createdAt: Date;
    userRoles: { role: { name: string } }[];
  }) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: user.userRoles.map((ur) => ur.role.name),
    };
  }
}
