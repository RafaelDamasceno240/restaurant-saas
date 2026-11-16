import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fromCents } from '../../common/util/money.util';
import { isTenantBlocked } from '../../common/util/tenant-status.util';
import { BranchAccessService } from '../branches/branch-access.service';
import { isOpenAt, readOpeningHours } from '../tenants/opening-hours';
import { PublicMenuResponseDto } from './dto/public-menu-response.dto';
import { publicImageUrl } from '../media/media-url';

@Injectable()
export class PublicMenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
  ) {}

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
        id: true,
        name: true,
        slug: true,
        status: true,
        timezone: true,
        description: true,
        instagram: true,
        logoMediaId: true,
        coverMediaId: true,
        brandColor: true,
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
                compareAtPriceCents: true,
                imageUrl: true,
                imageMediaId: true,
                soldOut: true,
                featured: true,
                badges: true,
                optionGroups: {
                  where: { group: { active: true } },
                  orderBy: { displayOrder: 'asc' },
                  select: {
                    group: {
                      select: {
                        id: true,
                        tenantId: true,
                        name: true,
                        minSelect: true,
                        maxSelect: true,
                        options: {
                          where: { active: true, soldOut: false },
                          orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
                          select: {
                            id: true,
                            name: true,
                            description: true,
                            priceCents: true,
                            maxQuantity: true,
                            imageMediaId: true,
                          },
                        },
                      },
                    },
                  },
                },
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
        products: category.products.map((product) => {
          const optionGroups = product.optionGroups
            // Defensive: a link can only ever point at a group of the same restaurant.
            .filter(({ group }) => group.tenantId === tenant.id)
            // A group with nothing left to choose is not offered.
            .filter(({ group }) => group.options.length > 0 || group.minSelect > 0)
            .map(({ group }) => ({
              id: group.id,
              name: group.name,
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              options: group.options.map((option) => ({
                id: option.id,
                name: option.name,
                description: option.description,
                price: fromCents(option.priceCents),
                maxQuantity: option.maxQuantity,
                imageUrl: publicImageUrl(option.imageMediaId, null),
              })),
            }));
          // A required group whose every option is sold out leaves no valid order: the product is
          // shown as sold out too (the order endpoint would refuse it with OPTION_REQUIRED).
          const requiredGroupEmpty = optionGroups.some(
            (g) => g.minSelect > 0 && g.options.length === 0,
          );
          return {
            id: product.id,
            name: product.name,
            description: product.description,
            price: fromCents(product.priceCents),
            compareAtPrice:
              product.compareAtPriceCents === null ? null : fromCents(product.compareAtPriceCents),
            imageUrl: publicImageUrl(product.imageMediaId, product.imageUrl),
            soldOut: product.soldOut || requiredGroupEmpty,
            featured: product.featured,
            badges: product.badges,
            optionGroups: optionGroups.filter((g) => g.options.length > 0),
          };
        }),
      }));

    // Online orders go to the tenant's default branch (same resolution as the
    // order itself), so these are the terms the customer will actually get.
    const branchId = await this.branchAccess.getDefaultBranchId(tenant.id);
    const branch = await this.prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: {
        deliveryEnabled: true,
        deliveryFeeCents: true,
        deliveryMinOrderCents: true,
        deliveryFreeAboveCents: true,
        phone: true,
        whatsapp: true,
        address: true,
        number: true,
        complement: true,
        neighborhood: true,
        city: true,
        state: true,
        zipCode: true,
        openingHours: true,
      },
    });

    // What the restaurant chose to publish in its profile (same branch as above). The e-mail,
    // the legal name and the document stay internal.
    const { address: street, number, complement, neighborhood, city, state, zipCode } = branch;
    const address = { street, number, complement, neighborhood, city, state, zipCode };
    const openingHours = readOpeningHours(branch.openingHours);

    return {
      restaurant: {
        name: tenant.name,
        slug: tenant.slug,
        description: tenant.description,
        phone: branch.phone,
        whatsapp: branch.whatsapp,
        instagram: tenant.instagram,
        address: Object.values(address).some((value) => value !== null) ? address : null,
        openingHours,
        openNow: isOpenAt(openingHours, new Date(), tenant.timezone),
        timeZone: tenant.timezone,
        logoUrl: publicImageUrl(tenant.logoMediaId, null),
        coverUrl: publicImageUrl(tenant.coverMediaId, null),
        brandColor: tenant.brandColor,
      },
      delivery: {
        enabled: branch.deliveryEnabled,
        fee: fromCents(branch.deliveryFeeCents),
        minOrder: fromCents(branch.deliveryMinOrderCents),
        freeAbove: branch.deliveryFreeAboveCents === null ? null : fromCents(branch.deliveryFreeAboveCents),
      },
      categories,
    };
  }
}
