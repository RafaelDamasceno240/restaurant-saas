import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { customerInactive, customerNotFound } from '../customers/customer-errors';
import { OrderCreationService } from '../order-creation/order-creation.service';
import { OrdersService } from '../orders/orders.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { OrderDetailDto } from '../orders/dto/order-admin-response.dto';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';

@Injectable()
export class PosOrdersService {
  constructor(
    private readonly orderCreation: OrderCreationService,
    private readonly ordersService: OrdersService,
    private readonly branchAccess: BranchAccessService,
    private readonly prisma: PrismaService,
  ) {}

  // Thin adapter: tenantId from the JWT, branch validated against the user,
  // source/fulfillment fixed server-side. For CASH, OrderCreationService
  // requires an OPEN cash session and writes the SALE movement atomically
  // (fatia 08); PIX/CARD never touch the drawer.
  async createOrder(user: AuthenticatedRequestUser, dto: CreatePosOrderDto): Promise<OrderDetailDto> {
    await this.branchAccess.assertAccess(user, dto.branchId);
    const customer = dto.customerId ? await this.resolveCustomer(user, dto.customerId) : null;

    const order = await this.orderCreation.createOrder({
      tenantId: user.tenantId,
      branchId: dto.branchId,
      source: 'COUNTER',
      recordCashSaleByUserId: user.userId,
      items: dto.items,
      // The snapshot is what was typed at the counter; when nothing was typed, the customer's
      // current name/phone are copied ONCE (later edits of the customer never rewrite the order).
      customerName: dto.customerName ?? customer?.name ?? null,
      customerPhone: dto.customerPhone ?? customer?.phone ?? null,
      customerId: customer?.id ?? null,
      fulfillmentType: 'PICKUP',
      address: null,
      paymentMethod: dto.paymentMethod,
      notes: null,
      idempotencyKey: dto.idempotencyKey,
    });

    return this.ordersService.findOneForTenant(user.tenantId, order.id);
  }

  // Linking needs customers.read (the PDV user must be allowed to see the customer), and the
  // customer must belong to the caller's tenant and be active. Another tenant's id is a 404.
  private async resolveCustomer(user: AuthenticatedRequestUser, customerId: string) {
    if (!user.permissions.includes('customers.read')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem permissão para vincular clientes.' });
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: user.tenantId },
      select: { id: true, name: true, phone: true, active: true },
    });
    if (!customer) throw customerNotFound();
    if (!customer.active) throw customerInactive();
    return customer;
  }
}
