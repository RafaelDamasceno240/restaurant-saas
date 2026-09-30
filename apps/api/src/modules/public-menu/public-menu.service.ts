import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fromCents } from '../../common/util/money.util';
import { isTenantBlocked } from '../../common/util/tenant-status.util';
import { PublicMenuResponseDto } from './dto/public-menu-response.dto';

@Injectable()
export class PublicMenuService {
  constructor(private readonly prisma: PrismaService) {}

  // Public, unauthenticated lookup — identified ONLY by slug, never by
  // tenantId (there is no JWT here to take one from). A single nested
  // query (Prisma batches the relation loads instead of one query per row),
  // filtered and `select`-scoped down to exactly the public fields — no
  // tenantId, no active/displayOrder flags, no internal/fiscal data ever
  // leaves this method.
  async getMenuBySlug(slug: string): Promise<PublicMenuResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: {
        name: true,
        slug: true,
        status: true,
        categories: {
          where: { active: true },
          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            description: true,
            products: {
              where: { active: true },
              orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
              select: {
                id: true,
                name: true,
                description: true,
                priceCents: true,
                imageUrl: true,
              },
            },
          },
        },
      },
    });

    if (!tenant || isTenantBlocked(tenant.status)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Restaurante não encontrado.' });
    }

    const categories = tenant.categories
      // A product's own `active` flag was already filtered in the query;
      // this drops categories left with zero active products (e.g. every
      // product in it is inactive), so the public menu never shows an
      // empty section.
      .filter((category) => category.products.length > 0)
      .map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        products: category.products.map((product) => ({
          id: product.id,
          name: product.name,
          description: product.description,
          price: fromCents(product.priceCents),
          imageUrl: product.imageUrl,
        })),
      }));

    return {
      restaurant: { name: tenant.name, slug: tenant.slug },
      categories,
    };
  }
}
