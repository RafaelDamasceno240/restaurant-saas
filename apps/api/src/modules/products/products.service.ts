import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { MediaService, UploadedImage } from '../media/media.service';
import { publicImageUrl } from '../media/media-url';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ReorderProductsDto } from './dto/product-admin.dto';
import { toCents, fromCents } from '../../common/util/money.util';

const PRODUCT_INCLUDE = {
  category: true,
  optionGroups: { select: { groupId: true }, orderBy: { displayOrder: 'asc' } },
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

const PROMO_MESSAGE =
  'O preço "de" (riscado) precisa ser maior que o preço de venda. Ajuste os valores ou remova a promoção.';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
    private readonly media: MediaService,
  ) {}

  async findAllForTenant(tenantId: string) {
    const products = await this.prisma.product.findMany({
      where: { tenantId },
      include: PRODUCT_INCLUDE,
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return products.map((p) => this.toDto(p));
  }

  async findOneForTenant(tenantId: string, id: string) {
    return this.toDto(await this.findRow(tenantId, id));
  }

  private async findRow(tenantId: string, id: string): Promise<ProductRow> {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Produto não encontrado.' });
    }
    return product;
  }

  async create(tenantId: string, dto: CreateProductDto) {
    // Reuses CategoriesService.findOneForTenant, which already 404s if the
    // category doesn't exist OR belongs to a different tenant — this is
    // exactly what stops a product from pointing at another tenant's
    // category.
    await this.categoriesService.findOneForTenant(tenantId, dto.categoryId);
    const priceCents = toCents(dto.price);
    const compareAtPriceCents = dto.compareAtPrice == null ? null : toCents(dto.compareAtPrice);
    assertPromotion(priceCents, compareAtPriceCents);

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description ?? null,
        priceCents,
        compareAtPriceCents,
        imageUrl: dto.imageUrl ?? null,
        active: dto.active ?? true,
        soldOut: dto.soldOut ?? false,
        featured: dto.featured ?? false,
        displayOrder: dto.displayOrder ?? 0,
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toDto(product);
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    const current = await this.findRow(tenantId, id); // 404 if missing or other tenant
    if (dto.categoryId) {
      await this.categoriesService.findOneForTenant(tenantId, dto.categoryId);
    }
    // The promotion is checked against the values the row will have, so changing only the price
    // cannot leave a "de" price below it.
    const priceCents = dto.price !== undefined ? toCents(dto.price) : current.priceCents;
    const compareAtPriceCents =
      dto.compareAtPrice === undefined
        ? current.compareAtPriceCents
        : dto.compareAtPrice === null
          ? null
          : toCents(dto.compareAtPrice);
    assertPromotion(priceCents, compareAtPriceCents);

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { priceCents } : {}),
        ...(dto.compareAtPrice !== undefined ? { compareAtPriceCents } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.soldOut !== undefined ? { soldOut: dto.soldOut } : {}),
        ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
        ...(dto.displayOrder !== undefined ? { displayOrder: dto.displayOrder } : {}),
      },
      include: PRODUCT_INCLUDE,
    });
    return this.toDto(product);
  }

  // The photo sent from the panel. It replaces the previous one (uploaded, imported or a pasted
  // link); the old image stays in media_assets, so an import report can still restore it.
  async setPhoto(tenantId: string, id: string, file: UploadedImage | undefined) {
    await this.findRow(tenantId, id);
    const mediaId = await this.media.storeImage(tenantId, file);
    const product = await this.prisma.product.update({
      where: { id },
      data: { imageMediaId: mediaId, imageUrl: null },
      include: PRODUCT_INCLUDE,
    });
    return this.toDto(product);
  }

  async removePhoto(tenantId: string, id: string) {
    await this.findRow(tenantId, id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { imageMediaId: null, imageUrl: null },
      include: PRODUCT_INCLUDE,
    });
    return this.toDto(product);
  }

  // Replaces the add-on groups of a product, in the order given. Every group must belong to this
  // restaurant: an id of another restaurant is the same 404 as a missing one.
  async setOptionGroups(tenantId: string, id: string, groupIds: string[]) {
    await this.findRow(tenantId, id);
    const found = await this.prisma.optionGroup.count({ where: { tenantId, id: { in: groupIds } } });
    if (found !== groupIds.length) {
      throw new NotFoundException({
        code: 'OPTION_GROUP_NOT_FOUND',
        message: 'Grupo de adicionais não encontrado.',
      });
    }
    await this.prisma.$transaction([
      this.prisma.productOptionGroup.deleteMany({ where: { tenantId, productId: id } }),
      this.prisma.productOptionGroup.createMany({
        data: groupIds.map((groupId, index) => ({
          tenantId,
          productId: id,
          groupId,
          displayOrder: index + 1,
        })),
      }),
    ]);
    return this.findOneForTenant(tenantId, id);
  }

  // A copy to start a similar product from: same category, price, promotion, photo and add-on
  // groups. It starts available (not sold out) and is never linked to an import source.
  async duplicate(tenantId: string, id: string) {
    const source = await this.findRow(tenantId, id);
    const copy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          tenantId,
          categoryId: source.categoryId,
          name: `${source.name} (cópia)`,
          description: source.description,
          priceCents: source.priceCents,
          compareAtPriceCents: source.compareAtPriceCents,
          imageUrl: source.imageUrl,
          imageMediaId: source.imageMediaId,
          active: source.active,
          featured: source.featured,
          badges: source.badges,
          displayOrder: source.displayOrder,
        },
      });
      if (source.optionGroups.length) {
        await tx.productOptionGroup.createMany({
          data: source.optionGroups.map((l, index) => ({
            tenantId,
            productId: created.id,
            groupId: l.groupId,
            displayOrder: index + 1,
          })),
        });
      }
      return created;
    });
    return this.findOneForTenant(tenantId, copy.id);
  }

  // The order of the products of one category. The list must be exactly the category's products,
  // so a screen with an outdated list cannot silently leave some of them out.
  async reorder(tenantId: string, dto: ReorderProductsDto) {
    await this.categoriesService.findOneForTenant(tenantId, dto.categoryId);
    const inCategory = await this.prisma.product.findMany({
      where: { tenantId, categoryId: dto.categoryId },
      select: { id: true },
    });
    const ids = new Set(inCategory.map((p) => p.id));
    if (ids.size !== dto.productIds.length || dto.productIds.some((pid) => !ids.has(pid))) {
      throw new ConflictException({
        code: 'PRODUCT_ORDER_OUTDATED',
        message: 'A lista de produtos desta categoria mudou. Atualize a página e tente de novo.',
      });
    }
    await this.prisma.$transaction(
      dto.productIds.map((pid, index) =>
        this.prisma.product.update({ where: { id: pid }, data: { displayOrder: index + 1 } }),
      ),
    );
    return this.findAllForTenant(tenantId);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findRow(tenantId, id);
    // OrderItem.product has onDelete: Restrict (fatia 04) — a product that
    // has ever been ordered must never be deletable, to preserve order
    // history. Checked explicitly here so this surfaces as a clean 409
    // instead of a raw Postgres foreign-key-violation error.
    const orderItemsCount = await this.prisma.orderItem.count({ where: { productId: id } });
    if (orderItemsCount > 0) {
      throw new ConflictException({
        code: 'PRODUCT_HAS_ORDERS',
        message: 'Não é possível excluir um produto que já foi pedido. Desative-o em vez de excluir.',
      });
    }
    // Same rule for TabItem.product (fatia 09, also onDelete: Restrict) — a
    // product ever added to a tab (open or already closed) must survive.
    const tabItemsCount = await this.prisma.tabItem.count({ where: { productId: id } });
    if (tabItemsCount > 0) {
      throw new ConflictException({
        code: 'PRODUCT_HAS_TAB_ITEMS',
        message: 'Não é possível excluir um produto que já foi usado em uma comanda. Desative-o em vez de excluir.',
      });
    }
    await this.prisma.product.delete({ where: { id } });
  }

  private toDto(product: ProductRow) {
    return {
      id: product.id,
      tenantId: product.tenantId,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      name: product.name,
      description: product.description,
      price: fromCents(product.priceCents),
      compareAtPrice:
        product.compareAtPriceCents === null ? null : fromCents(product.compareAtPriceCents),
      // The pasted link, as it was saved (the edit form shows it).
      imageUrl: product.imageUrl,
      // What the menu shows: the uploaded/imported photo, else the pasted link.
      photoUrl: publicImageUrl(product.imageMediaId, product.imageUrl),
      hasUploadedPhoto: product.imageMediaId !== null,
      active: product.active,
      soldOut: product.soldOut,
      featured: product.featured,
      displayOrder: product.displayOrder,
      optionGroupIds: product.optionGroups.map((l) => l.groupId),
      // Created by the menu importer (it keeps a link to the source).
      imported: product.externalId !== null,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}

function assertPromotion(priceCents: number, compareAtPriceCents: number | null): void {
  if (compareAtPriceCents !== null && compareAtPriceCents <= priceCents) {
    throw new BadRequestException({ code: 'PROMOTION_PRICE_INVALID', message: PROMO_MESSAGE });
  }
}
