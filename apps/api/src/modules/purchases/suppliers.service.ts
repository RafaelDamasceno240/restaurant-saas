import { Injectable } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { supplierAlreadyExists, supplierNotFound } from './purchase-errors';
import { CreateSupplierDto, ListSuppliersQueryDto, UpdateSupplierDto } from './dto/suppliers.dto';

const MAX_SUPPLIERS = 500;

export function toSupplierView(supplier: Supplier) {
  return {
    id: supplier.id,
    name: supplier.name,
    document: supplier.document,
    phone: supplier.phone,
    email: supplier.email,
    notes: supplier.notes,
    active: supplier.active,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthenticatedRequestUser, query: ListSuppliersQueryDto) {
    const search = query.search?.trim();
    const where: Prisma.SupplierWhereInput = {
      tenantId: user.tenantId,
      ...(query.includeInactive ? {} : { active: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { document: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const suppliers = await this.prisma.supplier.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      take: MAX_SUPPLIERS,
    });
    return suppliers.map(toSupplierView);
  }

  async findOne(user: AuthenticatedRequestUser, id: string) {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!supplier) throw supplierNotFound();
    return toSupplierView(supplier);
  }

  async create(user: AuthenticatedRequestUser, dto: CreateSupplierDto) {
    await this.assertNameAvailable(user.tenantId, dto.name);
    const supplier = await this.withUniqueNameGuard(() =>
      this.prisma.supplier.create({
        data: {
          tenantId: user.tenantId,
          name: dto.name,
          document: dto.document ?? null,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          notes: dto.notes ?? null,
        },
      }),
    );
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'SUPPLIER_CREATED',
      entity: 'Supplier',
      entityId: supplier.id,
      afterData: { name: supplier.name },
    });
    return toSupplierView(supplier);
  }

  async update(user: AuthenticatedRequestUser, id: string, dto: UpdateSupplierDto) {
    const current = await this.prisma.supplier.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!current) throw supplierNotFound();

    const willBeActive = dto.active ?? current.active;
    const nameChanged = dto.name !== undefined && dto.name.toLowerCase() !== current.name.toLowerCase();
    if (willBeActive && (nameChanged || (dto.active === true && !current.active))) {
      await this.assertNameAvailable(user.tenantId, dto.name ?? current.name, id);
    }

    const supplier = await this.withUniqueNameGuard(() =>
      this.prisma.supplier.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.document !== undefined ? { document: dto.document } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      }),
    );
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'SUPPLIER_UPDATED',
      entity: 'Supplier',
      entityId: id,
      beforeData: { name: current.name, active: current.active },
      afterData: { name: supplier.name, active: supplier.active },
    });
    return toSupplierView(supplier);
  }

  // The application check above gives the friendly error; the partial unique
  // index is what actually guarantees it under concurrency.
  private async withUniqueNameGuard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw supplierAlreadyExists();
      }
      throw error;
    }
  }

  private async assertNameAvailable(tenantId: string, name: string, exceptId?: string) {
    const existing = await this.prisma.supplier.findFirst({
      where: {
        tenantId,
        active: true,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (existing) throw supplierAlreadyExists();
  }
}
