import { Injectable } from '@nestjs/common';
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
  ) {}

  // Thin adapter: tenantId from the JWT, branch validated against the user,
  // source/fulfillment fixed server-side. For CASH, OrderCreationService
  // requires an OPEN cash session and writes the SALE movement atomically
  // (fatia 08); PIX/CARD never touch the drawer.
  async createOrder(user: AuthenticatedRequestUser, dto: CreatePosOrderDto): Promise<OrderDetailDto> {
    await this.branchAccess.assertAccess(user, dto.branchId);

    const order = await this.orderCreation.createOrder({
      tenantId: user.tenantId,
      branchId: dto.branchId,
      source: 'COUNTER',
      recordCashSaleByUserId: user.userId,
      items: dto.items,
      customerName: dto.customerName ?? null,
      customerPhone: dto.customerPhone ?? null,
      fulfillmentType: 'PICKUP',
      address: null,
      paymentMethod: dto.paymentMethod,
      notes: null,
      idempotencyKey: dto.idempotencyKey,
    });

    return this.ordersService.findOneForTenant(user.tenantId, order.id);
  }
}
