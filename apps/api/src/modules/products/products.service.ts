import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CategoriesService } from '../categories/categories.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { toCents, fromCents } from '../../common/util/money.util';

type ProductWithCategory = Prisma.ProductGetPayload<{ include: { category: true } }>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoriesService: CategoriesService,
  ) {}

  async findAllForTenant(tenantId: string) {
    const products = await this.prisma.product.findMany({
      where: { tenantId },
      include: { category: true },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return products.map((p) => this.toDto(p));
  }

  async findOneForTenant(tenantId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, tenantId },
      include: { category: true },
    });
    if (!product) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Produto não encontrado.' });
    }
    return this.toDto(product);
  }

  async create(tenantId: string, dto: CreateProductDto) {
    // Reuses CategoriesService.findOneForTenant, which already 404s if the
    // category doesn't exist OR belongs to a different tenant — this is
    // exactly what stops a product from pointing at another tenant's
    // category.
    await this.categoriesService.findOneForTenant(tenantId, dto.categoryId);

    const product = await this.prisma.product.create({
      data: {
        tenantId,
        categoryId: dto.categoryId,
        name: dto.name,
        description: dto.description,
        priceCents: toCents(dto.price),
        imageUrl: dto.imageUrl,
        active: dto.active ?? true,
        displayOrder: dto.displayOrder ?? 0,
      },
      include: { category: true },
    });
    return this.toDto(product);
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto) {
    await this.findOneForTenant(tenantId, id); // 404 if missing or other tenant
    if (dto.categoryId) {
      await this.categoriesService.findOneForTenant(tenantId, dto.categoryId);
    }

    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.price !== undefined ? { priceCents: toCents(dto.price) } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.displayOrder !== undefined ? { displayOrder: dto.displayOrder } : {}),
      },
      include: { category: true },
    });
    return this.toDto(product);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findOneForTenant(tenantId, id);
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

  private toDto(product: ProductWithCategory) {
    return {
      id: product.id,
      tenantId: product.tenantId,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      name: product.name,
      description: product.description,
      price: fromCents(product.priceCents),
      imageUrl: product.imageUrl,
      active: product.active,
      displayOrder: product.displayOrder,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}

