import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { fromCents, toCents } from '../../common/util/money.util';
import {
  CreateOptionGroupDto,
  CreateOptionItemDto,
  UpdateOptionGroupDto,
  UpdateOptionItemDto,
} from './dto/option-groups.dto';
import { groupRangeProblem, groupWarnings } from './option-group-rules';

const GROUP_INCLUDE = {
  options: { orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] },
  products: { select: { productId: true } },
} satisfies Prisma.OptionGroupInclude;

type GroupRow = Prisma.OptionGroupGetPayload<{ include: typeof GROUP_INCLUDE }>;

const groupNotFound = () =>
  new NotFoundException({
    code: 'OPTION_GROUP_NOT_FOUND',
    message: 'Grupo de adicionais não encontrado.',
  });
const optionNotFound = () =>
  new NotFoundException({ code: 'OPTION_NOT_FOUND', message: 'Adicional não encontrado.' });

// Add-on groups and their options, administered from the panel. Every query is scoped to the
// tenant of the JWT: an id of another restaurant is the same 404 as a missing one.
//
// Orders are never touched: each order line keeps its own copy of the group name, option name and
// unit price (order_item_options snapshots), so editing a price, renaming or deleting an option
// changes only what is sold from now on.
@Injectable()
export class OptionGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const groups = await this.prisma.optionGroup.findMany({
      where: { tenantId },
      include: GROUP_INCLUDE,
      orderBy: [{ name: 'asc' }],
    });
    return groups.map(toDto);
  }

  async findOne(tenantId: string, id: string) {
    return toDto(await this.findRow(tenantId, id));
  }

  private async findRow(tenantId: string, id: string, db: Prisma.TransactionClient = this.prisma) {
    const group = await db.optionGroup.findFirst({
      where: { id, tenantId },
      include: GROUP_INCLUDE,
    });
    if (!group) throw groupNotFound();
    return group;
  }

  async create(tenantId: string, dto: CreateOptionGroupDto) {
    assertRange(dto.minSelect, dto.maxSelect);
    const group = await this.prisma.optionGroup.create({
      data: {
        tenantId,
        name: dto.name,
        minSelect: dto.minSelect,
        maxSelect: dto.maxSelect,
        active: dto.active ?? true,
      },
      include: GROUP_INCLUDE,
    });
    return toDto(group);
  }

  async update(tenantId: string, id: string, dto: UpdateOptionGroupDto) {
    const current = await this.findRow(tenantId, id);
    assertRange(dto.minSelect ?? current.minSelect, dto.maxSelect ?? current.maxSelect);
    const group = await this.prisma.optionGroup.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.minSelect !== undefined ? { minSelect: dto.minSelect } : {}),
        ...(dto.maxSelect !== undefined ? { maxSelect: dto.maxSelect } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
      include: GROUP_INCLUDE,
    });
    return toDto(group);
  }

  // Removes the group, its options and its links to products. Orders that used it keep their
  // snapshots (the option id on the order line becomes null).
  async remove(tenantId: string, id: string): Promise<void> {
    await this.findRow(tenantId, id);
    await this.prisma.optionGroup.delete({ where: { id } });
  }

  async addOption(tenantId: string, groupId: string, dto: CreateOptionItemDto) {
    const group = await this.findRow(tenantId, groupId);
    const last = group.options.reduce((max, o) => Math.max(max, o.displayOrder), 0);
    await this.prisma.optionItem.create({
      data: {
        tenantId,
        groupId,
        name: dto.name,
        description: dto.description ?? null,
        priceCents: toCents(dto.price),
        maxQuantity: dto.maxQuantity ?? 1,
        active: dto.active ?? true,
        soldOut: dto.soldOut ?? false,
        displayOrder: last + 1,
      },
    });
    return this.findOne(tenantId, groupId);
  }

  async updateOption(
    tenantId: string,
    groupId: string,
    optionId: string,
    dto: UpdateOptionItemDto,
  ) {
    await this.findOption(tenantId, groupId, optionId);
    await this.prisma.optionItem.update({
      where: { id: optionId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { priceCents: toCents(dto.price) } : {}),
        ...(dto.maxQuantity !== undefined ? { maxQuantity: dto.maxQuantity } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.soldOut !== undefined ? { soldOut: dto.soldOut } : {}),
      },
    });
    return this.findOne(tenantId, groupId);
  }

  async removeOption(tenantId: string, groupId: string, optionId: string) {
    await this.findOption(tenantId, groupId, optionId);
    await this.prisma.optionItem.delete({ where: { id: optionId } });
    return this.findOne(tenantId, groupId);
  }

  async reorderOptions(tenantId: string, groupId: string, optionIds: string[]) {
    const group = await this.findRow(tenantId, groupId);
    const ids = new Set(group.options.map((o) => o.id));
    if (ids.size !== optionIds.length || optionIds.some((id) => !ids.has(id))) {
      throw new ConflictException({
        code: 'OPTION_ORDER_OUTDATED',
        message: 'A lista de adicionais deste grupo mudou. Atualize a página e tente de novo.',
      });
    }
    await this.prisma.$transaction(
      optionIds.map((id, index) =>
        this.prisma.optionItem.update({ where: { id }, data: { displayOrder: index + 1 } }),
      ),
    );
    return this.findOne(tenantId, groupId);
  }

  // Which products offer this group. Products added get it as their last group; products removed
  // lose it; the position of every other group of a product is kept.
  async setProducts(tenantId: string, groupId: string, productIds: string[]) {
    await this.findRow(tenantId, groupId);
    const found = await this.prisma.product.count({ where: { tenantId, id: { in: productIds } } });
    if (found !== productIds.length) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Produto não encontrado.' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productOptionGroup.deleteMany({
        where: { tenantId, groupId, productId: { notIn: productIds } },
      });
      const linked = new Set(
        (
          await tx.productOptionGroup.findMany({
            where: { tenantId, groupId },
            select: { productId: true },
          })
        ).map((l) => l.productId),
      );
      const toAdd = productIds.filter((id) => !linked.has(id));
      if (toAdd.length === 0) return;
      const lastByProduct = new Map(
        (
          await tx.productOptionGroup.groupBy({
            by: ['productId'],
            where: { tenantId, productId: { in: toAdd } },
            _max: { displayOrder: true },
          })
        ).map((r) => [r.productId, r._max.displayOrder ?? 0]),
      );
      await tx.productOptionGroup.createMany({
        data: toAdd.map((productId) => ({
          tenantId,
          productId,
          groupId,
          displayOrder: (lastByProduct.get(productId) ?? 0) + 1,
        })),
      });
    });
    return this.findOne(tenantId, groupId);
  }

  private async findOption(tenantId: string, groupId: string, optionId: string) {
    const option = await this.prisma.optionItem.findFirst({
      where: { id: optionId, groupId, tenantId },
      select: { id: true },
    });
    if (!option) {
      // The group itself may be the missing piece: say so.
      await this.findRow(tenantId, groupId);
      throw optionNotFound();
    }
    return option;
  }
}

function assertRange(minSelect: number, maxSelect: number): void {
  const problem = groupRangeProblem(minSelect, maxSelect);
  if (problem)
    throw new BadRequestException({ code: 'OPTION_GROUP_RANGE_INVALID', message: problem });
}

function toDto(group: GroupRow) {
  return {
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    required: group.minSelect > 0,
    active: group.active,
    imported: group.externalId !== null,
    productIds: group.products.map((p) => p.productId),
    warnings: groupWarnings(group),
    options: group.options.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      price: fromCents(o.priceCents),
      maxQuantity: o.maxQuantity,
      active: o.active,
      soldOut: o.soldOut,
      displayOrder: o.displayOrder,
      imported: o.externalId !== null,
    })),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
