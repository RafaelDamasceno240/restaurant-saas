import { GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isTenantBlocked } from '../../common/util/tenant-status.util';
import { publicImageUrl } from '../media/media-url';
import { AssistantEngineService } from './assistant/assistant-engine.service';
import { CartLine, PricingRefused } from './assistant/assistant-toolbox';
import { hashToken } from './whatsapp-reply.service';

export interface SharedCartLine {
  productId: string;
  name: string;
  // The same photo the public menu shows (uploaded/imported image, else the pasted link), or null.
  imageUrl: string | null;
  quantity: number;
  unitPriceCents: number;
  options: {
    optionId: string;
    groupName: string;
    name: string;
    priceCents: number;
    quantity: number;
  }[];
  notes: string | null;
  available: boolean;
  problem: string | null;
}

// The cart behind a checkout link, priced NOW by the checkout's own rules (a price that changed
// since the conversation shows the new price; a product that sold out is flagged). Read-only:
// the order is only created by the existing public checkout, after the customer confirms there.
@Injectable()
export class WhatsappCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AssistantEngineService,
  ) {}

  async readSharedCart(slug: string, token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound();
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, status: true },
    });
    if (!tenant || isTenantBlocked(tenant.status)) throw notFound();
    const link = await this.prisma.whatsappCheckoutLink.findFirst({
      where: { tokenHash: hashToken(token), tenantId: tenant.id },
    });
    if (!link) throw notFound();
    if (link.expiresAt <= new Date()) {
      throw new GoneException({
        code: 'LINK_EXPIRED',
        message: 'Este link expirou. Peça um novo pelo WhatsApp.',
      });
    }
    if (!link.openedAt)
      await this.prisma.whatsappCheckoutLink.update({
        where: { id: link.id },
        data: { openedAt: new Date() },
      });

    const lines = Array.isArray(link.cart) ? (link.cart as unknown as CartLine[]) : [];
    // Photos of this restaurant's products only (tenant-scoped), resolved like the public menu.
    const photos = new Map(
      (
        await this.prisma.product.findMany({
          where: { tenantId: tenant.id, id: { in: lines.map((l) => l.productId) } },
          select: { id: true, imageMediaId: true, imageUrl: true },
        })
      ).map((p) => [p.id, publicImageUrl(p.imageMediaId, p.imageUrl)]),
    );
    const items: SharedCartLine[] = [];
    for (const line of lines) {
      try {
        const [priced] = await this.engine.priceLines(tenant.id, [line]);
        items.push({
          productId: priced.productId,
          name: priced.name,
          imageUrl: photos.get(priced.productId) ?? null,
          quantity: priced.quantity,
          unitPriceCents: priced.unitPriceCents,
          options: priced.options.map((o) => ({
            optionId: o.optionId,
            groupName: o.group,
            name: o.name,
            priceCents: o.unitPriceCents,
            quantity: o.quantity,
          })),
          notes: priced.notes,
          available: true,
          problem: null,
        });
      } catch (error) {
        if (!(error instanceof PricingRefused)) throw error;
        const product = await this.prisma.product.findFirst({
          where: { id: line.productId, tenantId: tenant.id },
          select: { name: true },
        });
        items.push({
          productId: line.productId,
          name: product?.name ?? 'Produto indisponível',
          imageUrl: photos.get(line.productId) ?? null,
          quantity: line.quantity,
          unitPriceCents: 0,
          options: [],
          notes: line.notes,
          available: false,
          problem: error.message,
        });
      }
    }
    return {
      restaurant: { name: tenant.name, slug: tenant.slug },
      expiresAt: link.expiresAt.toISOString(),
      items,
      subtotalCents: items
        .filter((i) => i.available)
        .reduce((s, i) => s + i.unitPriceCents * i.quantity, 0),
    };
  }
}

const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'Link não encontrado.' });
