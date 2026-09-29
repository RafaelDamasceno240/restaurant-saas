import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

// Same rule as every other tenant-owned module: tenantId is always passed in
// explicitly by the controller (from the JWT via @CurrentUser()), never read
// from the DTO/body. See docs/multi-tenancy.md.
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForTenant(tenantId: string) {
    return this.prisma.category.findMany({
      where: { tenantId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOneForTenant(tenantId: string, id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, tenantId } });
    if (!category) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Categoria não encontrada.' });
    }
    return category;
  }

  create(tenantId: string, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        active: dto.active ?? true,
        displayOrder: dto.displayOrder ?? 0,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOneForTenant(tenantId, id); // 404 if missing or other tenant
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    await this.findOneForTenant(tenantId, id);
    const productsCount = await this.prisma.product.count({ where: { tenantId, categoryId: id } });
    if (productsCount > 0) {
      throw new ConflictException({
        code: 'CATEGORY_HAS_PRODUCTS',
        message: 'Não é possível excluir uma categoria que possui produtos vinculados.',
      });
    }
    await this.prisma.category.delete({ where: { id } });
  }
}
