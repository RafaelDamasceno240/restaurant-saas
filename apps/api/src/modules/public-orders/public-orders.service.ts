import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { fromCents } from '../../common/util/money.util';
import { OrderCreationService, OrderWithItems } from '../order-creation/order-creation.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderResponseDto, PublicOrderConfirmationDto } from './dto/order-response.dto';

@Injectable()
export class PublicOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderCreation: OrderCreationService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // Thin adapter over OrderCreationService (fatia 07): this method's only
  // remaining job is channel-specific — resolve the tenant EXCLUSIVELY by
  // slug (there is no JWT here, and the request carries no tenantId to
  // (mis)trust in the first place) and shape the DTO into the shared
  // input. Product validation, price recalculation, and the transactional
  // write all live in OrderCreationService now, shared with the PDV
  // (apps/api/.../pos/pos-orders.service.ts) — see that class's own
  // comment for why this was extracted.
  async createOrder(dto: CreateOrderDto): Promise<OrderResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: dto.restaurantSlug } });
    if (!tenant) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Restaurante não encontrado.' });
    }

    const order = await this.orderCreation.createOrder({
      tenantId: tenant.id,
      // MVP: online orders go to the tenant's default branch (no branch
      // picker on the public menu yet). No cash-sale flag: online CASH is
      // paid on delivery/pickup and does not touch the drawer.
      branchId: await this.branchAccess.getDefaultBranchId(tenant.id),
      source: 'ONLINE',
      items: dto.items,
      customerName: dto.customer.name,
      customerPhone: dto.customer.phone,
      fulfillmentType: dto.fulfillmentType,
      address: dto.address,
      paymentMethod: dto.paymentMethod,
      notes: dto.notes,
    });

    return this.toDto(order);
  }

  // Used by the confirmation page (GET /public/orders/:slug/:orderId) — also
  // slug-scoped, so an order id can never be read under the wrong
  // restaurant's URL. This route has no auth and no secret token, so it
  // deliberately returns the narrower PublicOrderConfirmationDto, never the
  // full OrderResponseDto — see the comment on that class for why.
  async findPublicOrder(slug: string, orderId: string): Promise<PublicOrderConfirmationDto> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Restaurante não encontrado.' });
    }

    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId: tenant.id },
      include: { items: true },
    });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
    }

    // Built by dropping fields from the full DTO (not a second, parallel
    // mapping) so there is exactly one place that turns a DB row into
    // customer-facing shapes — but the personal fields are stripped right
    // here, visibly, rather than the caller having to remember to do it.
    const { customerName, customerPhone, ...confirmation } = this.toDto(order);
    return confirmation;
  }

  private toDto(order: OrderWithItems): OrderResponseDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      // Non-null assertion is safe here: this service is only ever reached
      // via the online checkout path, whose CreateOrderDto.customer is
      // required — only PDV (fatia 07) orders can have these null, and
      // this DTO is never used for PDV orders.
      customerName: order.customerName!,
      customerPhone: order.customerPhone!,
      fulfillmentType: order.fulfillmentType,
      address:
        order.fulfillmentType === 'DELIVERY'
          ? {
              street: order.street ?? '',
              number: order.number ?? '',
              complement: order.complement,
              neighborhood: order.neighborhood ?? '',
              city: order.city ?? '',
              state: order.state ?? '',
              zipCode: order.zipCode ?? '',
            }
          : null,
      paymentMethod: order.paymentMethod,
      notes: order.notes,
      items: order.items.map((item) => ({
        productId: item.productId,
        name: item.productNameSnapshot,
        unitPrice: fromCents(item.unitPriceCents),
        quantity: item.quantity,
        subtotal: fromCents(item.subtotalCents),
      })),
      subtotal: fromCents(order.subtotalCents),
      total: fromCents(order.totalCents),
      createdAt: order.createdAt,
    };
  }
}
