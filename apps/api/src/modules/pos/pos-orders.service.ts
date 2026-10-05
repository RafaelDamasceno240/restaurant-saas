import { ForbiddenException, Injectable } from '@nestjs/common';
import { CustomerLookupService } from '../customers/customer-lookup.service';
import { OrderCreationService } from '../order-creation/order-creation.service';
import { OrdersService } from '../orders/orders.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { OrderDetailDto } from '../orders/dto/order-admin-response.dto';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CreatePosOrderDto } from './dto/create-pos-order.dto';
import { PosCouponPreviewDto } from '../coupons/dto/coupons.dto';

@Injectable()
export class PosOrdersService {
  constructor(
    private readonly orderCreation: OrderCreationService,
    private readonly ordersService: OrdersService,
    private readonly branchAccess: BranchAccessService,
    private readonly customers: CustomerLookupService,
  ) {}

  // Thin adapter: tenantId from the JWT, branch validated against the user,
  // source/fulfillment fixed server-side. For CASH, OrderCreationService
  // requires an OPEN cash session and writes the SALE movement atomically
  // (fatia 08); PIX/CARD never touch the drawer.
  async createOrder(user: AuthenticatedRequestUser, dto: CreatePosOrderDto): Promise<OrderDetailDto> {
    await this.branchAccess.assertAccess(user, dto.branchId);
    if (dto.couponCode) this.assertCanApplyCoupon(user);
    if (dto.cashbackToUseCents) this.assertCanUseCashback(user);
    if (dto.paymentMethod === 'ON_ACCOUNT') this.assertCanSellOnAccount(user);
    const customer = dto.customerId ? await this.customers.resolveForOrder(user, dto.customerId) : null;

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
      couponCode: dto.couponCode ?? null,
      cashbackToUseCents: dto.cashbackToUseCents ?? null,
      creditTerms: dto.paymentMethod === 'ON_ACCOUNT' ? (dto.creditTerms ?? null) : null,
      fulfillmentType: 'PICKUP',
      address: null,
      paymentMethod: dto.paymentMethod,
      notes: null,
      idempotencyKey: dto.idempotencyKey,
    });

    return this.ordersService.findOneForTenant(user.tenantId, order.id);
  }

  // Read-only: the same pricing and the same rules as createOrder(), nothing consumed or locked.
  // A preview can be stale by the time the sale is confirmed; the sale re-validates everything.
  async previewCoupon(user: AuthenticatedRequestUser, dto: PosCouponPreviewDto) {
    this.assertCanApplyCoupon(user);
    await this.branchAccess.assertAccess(user, dto.branchId);
    const customer = dto.customerId ? await this.customers.resolveForOrder(user, dto.customerId) : null;
    return this.orderCreation.previewCoupon({
      tenantId: user.tenantId,
      branchId: dto.branchId,
      items: dto.items,
      couponCode: dto.code,
      customerId: customer?.id ?? null,
    });
  }

  // Selling on account (fiado) is a permission of its own (receivables.sell): it puts the
  // restaurant's money at risk, which a plain sale does not.
  private assertCanSellOnAccount(user: AuthenticatedRequestUser) {
    if (!user.permissions.includes('receivables.sell')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem permissão para vender fiado.' });
    }
  }

  // Spending a customer's cashback is a permission of its own (cashback.use).
  private assertCanUseCashback(user: AuthenticatedRequestUser) {
    if (!user.permissions.includes('cashback.use')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem permissão para usar cashback.' });
    }
  }

  // Using a coupon is a permission of its own: it is not implied by pos.create, and it is not
  // the administrative coupons.* set either.
  private assertCanApplyCoupon(user: AuthenticatedRequestUser) {
    if (!user.permissions.includes('coupons.apply')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem permissão para aplicar cupons.' });
    }
  }
}
