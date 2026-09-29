import { BadRequestException, Injectable } from '@nestjs/common';
import { InventoryItem, InventoryUnit, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import {
  computeMargin,
  convertQuantity,
  Decimal,
  displayQuantityIn,
  lineCostCents,
  producibleUnits,
  stockStatus,
  toDisplay,
  toQuantity,
  UnitConversionError,
} from './inventory-calculations';
import { duplicateItems, hasDuplicates, inventoryItemNotFound, productNotFound } from './inventory-errors';
import { PutRecipeDto, RecipeListQueryDto, RecipeQueryDto } from './dto/recipes.dto';

const recipeInclude = {
  items: { include: { inventoryItem: true } },
} satisfies Prisma.ProductRecipeInclude;

type RecipeWithItems = Prisma.ProductRecipeGetPayload<{ include: typeof recipeInclude }>;
type BalanceRow = { quantity: Decimal; averageCostCents: number };
type RecipeStatus = 'NO_RECIPE' | 'OK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

@Injectable()
export class RecipesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async list(user: AuthenticatedRequestUser, query: RecipeListQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const search = query.search?.trim();
    const [products, balances] = await Promise.all([
      this.prisma.product.findMany({
        where: {
          tenantId: user.tenantId,
          ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
        },
        orderBy: [{ category: { displayOrder: 'asc' } }, { displayOrder: 'asc' }, { name: 'asc' }],
        include: { category: { select: { id: true, name: true } }, recipe: { include: recipeInclude } },
      }),
      this.balancesFor(user.tenantId, query.branchId),
    ]);

    return products.map((product) => {
      const recipeItems = product.recipe?.items ?? [];
      const costCents = recipeItems.length ? recipeCostCents(recipeItems, balances) : null;
      const margin = costCents === null ? null : computeMargin(product.priceCents, costCents);
      return {
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        active: product.active,
        category: product.category,
        priceCents: product.priceCents,
        hasRecipe: recipeItems.length > 0,
        itemCount: recipeItems.length,
        costCents,
        marginCents: margin?.marginCents ?? null,
        marginPercent: margin?.marginPercent ?? null,
        producibleUnits: producibleUnits(
          recipeItems.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity })),
          quantitiesOf(balances),
        ),
        status: recipeStatus(recipeItems, balances),
      };
    });
  }

  async get(user: AuthenticatedRequestUser, productId: string, query: RecipeQueryDto) {
    if (query.branchId) await this.branchAccess.assertAccess(user, query.branchId);
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId: user.tenantId },
      include: { recipe: { include: recipeInclude } },
    });
    if (!product) throw productNotFound();
    const balances = query.branchId ? await this.balancesFor(user.tenantId, query.branchId) : null;
    return this.toDetail(product, product.recipe, balances);
  }

  async put(user: AuthenticatedRequestUser, productId: string, dto: PutRecipeDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId: user.tenantId },
      include: { recipe: { include: { items: true } } },
    });
    if (!product) throw productNotFound();

    const ids = dto.items.map((line) => line.inventoryItemId);
    if (hasDuplicates(ids)) throw duplicateItems('Cada insumo só pode aparecer uma vez na ficha técnica.');
    const inventoryItems = await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids }, tenantId: user.tenantId },
    });
    if (inventoryItems.length !== ids.length) throw inventoryItemNotFound();
    const itemById = new Map(inventoryItems.map((item) => [item.id, item]));

    const lines = dto.items.map((input) => {
      const item = itemById.get(input.inventoryItemId)!;
      const inputUnit = input.unit ?? item.unit;
      return { inventoryItemId: item.id, inputUnit, quantity: toStockUnit(item, input.quantity, inputUnit) };
    });

    await this.prisma.$transaction(async (tx) => {
      if (lines.length === 0) {
        await tx.productRecipe.deleteMany({ where: { productId: product.id, tenantId: user.tenantId } });
        return;
      }
      const recipe = await tx.productRecipe.upsert({
        where: { productId: product.id },
        create: { tenantId: user.tenantId, productId: product.id, name: dto.name?.trim() || null },
        update: { name: dto.name?.trim() || null },
      });
      await tx.productRecipeItem.deleteMany({ where: { recipeId: recipe.id } });
      await tx.productRecipeItem.createMany({
        data: lines.map((line) => ({ recipeId: recipe.id, ...line })),
      });
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INVENTORY_RECIPE_UPDATED',
      entity: 'ProductRecipe',
      entityId: product.id,
      beforeData: {
        items: (product.recipe?.items ?? []).map((line) => ({
          inventoryItemId: line.inventoryItemId,
          quantity: line.quantity.toFixed(3),
        })),
      },
      afterData: {
        items: lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: line.quantity.toFixed(3) })),
      },
    });

    return this.get(user, product.id, {});
  }

  private toDetail(
    product: { id: string; name: string; priceCents: number },
    recipe: RecipeWithItems | null,
    balances: Map<string, BalanceRow> | null,
  ) {
    const items = (recipe?.items ?? [])
      .map((line) => {
        const unitCostCents = balances ? balances.get(line.inventoryItemId)?.averageCostCents ?? 0 : null;
        return {
          inventoryItemId: line.inventoryItemId,
          name: line.inventoryItem.name,
          unit: line.inventoryItem.unit,
          quantity: toDisplay(line.quantity),
          inputUnit: line.inputUnit,
          inputQuantity: toDisplay(displayQuantityIn(line.quantity, line.inventoryItem.unit, line.inputUnit)),
          unitCostCents,
          subtotalCents: unitCostCents === null ? null : lineCostCents(line.quantity, unitCostCents),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    const costCents = balances && items.length ? items.reduce((sum, line) => sum + (line.subtotalCents ?? 0), 0) : null;
    const margin = costCents === null ? null : computeMargin(product.priceCents, costCents);
    return {
      productId: product.id,
      productName: product.name,
      name: recipe?.name ?? null,
      priceCents: product.priceCents,
      items,
      costCents,
      marginCents: margin?.marginCents ?? null,
      marginPercent: margin?.marginPercent ?? null,
      updatedAt: recipe?.updatedAt ?? null,
    };
  }

  private async balancesFor(tenantId: string, branchId: string): Promise<Map<string, BalanceRow>> {
    const rows = await this.prisma.inventoryBalance.findMany({
      where: { tenantId, branchId },
      select: { inventoryItemId: true, quantity: true, averageCostCents: true },
    });
    return new Map(rows.map((row) => [row.inventoryItemId, row]));
  }
}

function toStockUnit(item: InventoryItem, quantity: number, inputUnit: InventoryUnit): Decimal {
  try {
    return convertQuantity(toQuantity(quantity), inputUnit, item.unit);
  } catch (error) {
    if (!(error instanceof UnitConversionError)) throw error;
    throw new BadRequestException({
      code: error.code,
      message:
        error.code === 'INCOMPATIBLE_UNIT'
          ? `Unidade incompatível com o insumo "${item.name}" (${item.unit}).`
          : `Quantidade de "${item.name}" precisa de no máximo 3 casas decimais em ${item.unit}.`,
    });
  }
}

function recipeCostCents(items: RecipeWithItems['items'], balances: Map<string, BalanceRow>): number {
  return items.reduce(
    (sum, line) => sum + lineCostCents(line.quantity, balances.get(line.inventoryItemId)?.averageCostCents ?? 0),
    0,
  );
}

function quantitiesOf(balances: Map<string, BalanceRow>): Map<string, Decimal> {
  return new Map([...balances.entries()].map(([id, row]) => [id, row.quantity]));
}

function recipeStatus(items: RecipeWithItems['items'], balances: Map<string, BalanceRow>): RecipeStatus {
  if (items.length === 0) return 'NO_RECIPE';
  const statuses = items.map((line) =>
    stockStatus(balances.get(line.inventoryItemId)?.quantity ?? new Decimal(0), line.inventoryItem.minStock),
  );
  if (statuses.includes('OUT_OF_STOCK')) return 'OUT_OF_STOCK';
  if (statuses.includes('LOW_STOCK')) return 'LOW_STOCK';
  return 'OK';
}
