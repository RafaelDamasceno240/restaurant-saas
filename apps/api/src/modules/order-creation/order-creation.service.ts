import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FulfillmentType,
  Order,
  OrderItem,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateOrderNumber } from '../../common/util/order-number.util';
import { CashRegisterService } from '../cash/cash-register.service';
import { InventoryService } from '../inventory/inventory.service';
import { statusConsumesStock } from '../inventory/inventory-calculations';
import { normalizeNotes } from '../delivery/delivery-input';
import { DeliverySettings, priceDelivery } from '../delivery/delivery-pricing';
import { orderTotalTooLarge } from '../delivery/delivery-errors';
import { CouponRedemptionService } from '../coupons/coupon-redemption.service';
import { computeOrderTotalCents } from '../coupons/coupon-calculations';
import { normalizeCouponCode } from '../coupons/coupon-input';
import { isCouponError } from '../coupons/coupon-errors';

export interface OrderCreationItemInput {
  productId: string;
  quantity: number;
}

export interface OrderCreationAddressInput {
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface OrderCreationInput {
  tenantId: string;
  // Fatia 08: always resolved and validated by the CALLER (PDV: BranchAccessService
  // against the user; online: tenant's default branch). Never raw client input.
  branchId: string;
  // Set only by the PDV. When present AND paymentMethod is CASH, the order
  // requires an OPEN cash session for the branch and a SALE movement is
  // written in the SAME transaction (no Order without SALE, no SALE without
  // Order). Online CASH (pay on delivery/pickup) does not touch the drawer.
  recordCashSaleByUserId?: string;
  // Set by the CALLING service (PublicOrdersService always passes ONLINE;
  // PosOrdersService always passes COUNTER) — never taken from raw client
  // input at any layer. See docs/PROJECT_STATUS.md "Fatia 07".
  source: OrderSource;
  items: OrderCreationItemInput[];
  customerName: string | null;
  customerPhone: string | null;
  // Fase 11: optional link to a CRM customer. ALWAYS resolved and validated by the CALLER
  // (PDV checks tenant + active); the public checkout never sets it. The snapshot above
  // (customerName/customerPhone) is what the order shows and never changes afterwards.
  customerId?: string | null;
  fulfillmentType: FulfillmentType;
  address?: OrderCreationAddressInput | null;
  paymentMethod: PaymentMethod;
  notes?: string | null;
  // Delivery instructions ("Portão azul"), kept on the delivery and separate from `notes`
  // (the order's general observation). Ignored unless fulfillmentType is DELIVERY.
  deliveryNotes?: string | null;
  // Fase 11 (fatia 2): optional coupon CODE typed by the customer/cashier. It is the only coupon
  // input there is: the discount, the limits and the eligibility are all decided here, on the
  // server, inside the order transaction. The caller must have checked coupons.apply (PDV).
  couponCode?: string | null;
  idempotencyKey?: string;
}

// An item whose price/name were ALREADY fixed by the caller from a trusted
// server-side source. Used by the table checkout (fatia 10): the price is the
// TabItem snapshot taken when the item was added, never the current Product
// price. Never built from client input.
export interface PricedOrderItem {
  productId: string;
  productNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
}

export interface PricedOrderInput extends Omit<OrderCreationInput, 'items'> {
  items: PricedOrderItem[];
  status?: OrderStatus;
  tabId?: string;
  idempotencyKey?: string;
}

export type OrderWithItems = Order & { items: OrderItem[] };

export interface OrderCreationResult {
  order: OrderWithItems;
  cashMovementId: string | null;
  // Fase 09: SALE stock movements written in the same transaction (only for
  // orders created already confirmed — e.g. table checkout, born COMPLETED).
  stockMovementIds: string[];
}

// ===========================================================================
// Single place where an Order + its OrderItems get created, for the public
// checkout (fatia 04), the authenticated PDV (fatia 07) and the table
// checkout (fatia 10). Extracted here specifically so this exact set of
// rules — compute totals, lock the cash session for CASH, write Order +
// items + SALE in one transaction — exists in exactly one place.
//
//  - createOrder(): resolves prices from the CURRENT Product rows (checkout
//    and PDV) and runs its own transaction. Behavior unchanged since fatia 08.
//  - createPricedOrderInTx(): the shared core. Takes already-priced items and
//    an EXTERNAL transaction, so a caller (TabsService) can make the Order
//    part of a larger atomic unit (tab lock + payment + closing the tab).
// ===========================================================================
@Injectable()
export class OrderCreationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cashRegister: CashRegisterService,
    private readonly inventory: InventoryService,
    private readonly coupons: CouponRedemptionService,
  ) {}

  async createOrder(rawInput: OrderCreationInput): Promise<OrderWithItems> {
    // One canonical spelling from here on: the replay comparison, the lock and the snapshot all
    // see "PROMO10" whatever was typed. An empty code means no coupon.
    const couponCode = rawInput.couponCode ? normalizeCouponCode(rawInput.couponCode) || null : null;
    const input: OrderCreationInput = { ...rawInput, couponCode };

    if (input.idempotencyKey) {
      const replay = await this.findReplay(input);
      if (replay) return replay;
    }

    if (input.fulfillmentType === 'DELIVERY' && !input.address) {
      throw new BadRequestException({
        code: 'ADDRESS_REQUIRED',
        message: 'Endereço é obrigatório para entrega.',
      });
    }

    const pricedItems = await this.priceItems(input.tenantId, input.items);

    let result: OrderCreationResult;
    try {
      result = await this.prisma.$transaction((tx) =>
        this.createPricedOrderInTx(tx, { ...input, items: pricedItems }),
      );
    } catch (error) {
      // A duplicate of an in-flight request loses the race in one of two ways: it reaches the
      // order insert and collides on the idempotency key, or - with a limited coupon - it waits
      // for the coupon lock, then finds the usage already taken by the WINNER (its twin). In both
      // cases the request is a replay, so it gets the original order (findReplay re-checks that
      // it really is the same request) and never a spurious "coupon used up".
      if (input.idempotencyKey && (this.isIdempotencyKeyViolation(error) || isCouponError(error))) {
        const replay = await this.findReplay(input);
        if (replay) return replay;
      }
      throw error;
    }

    await this.recordCreationAudit(result, input.source, input.recordCashSaleByUserId);
    return result.order;
  }

  // Every product is re-read from the DB, scoped to THIS tenant and active=true, in one query.
  // Anything not in this result set - wrong id, another tenant's product, or inactive - is simply
  // unavailable; the caller never learns which, to avoid leaking cross-tenant existence.
  // Client-supplied price/name for any item is structurally impossible to reach here:
  // OrderCreationItemInput only ever carries productId + quantity. Shared by the order and by
  // the coupon preview, so both always price the basket the same way.
  async priceItems(tenantId: string, items: OrderCreationItemInput[]): Promise<PricedOrderItem[]> {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, active: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const unavailable = items.find((item) => !productById.has(item.productId));
    if (unavailable) {
      throw new BadRequestException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'Um ou mais produtos do pedido não estão mais disponíveis.',
      });
    }

    return items.map((item) => {
      const product = productById.get(item.productId)!;
      return {
        productId: product.id,
        productNameSnapshot: product.name,
        unitPriceCents: product.priceCents,
        quantity: item.quantity,
      };
    });
  }

  // Read-only: what the coupon would take off this basket right now. Same pricing and the same
  // rules as the order; consumes nothing and locks nothing, so it may be stale by the time the
  // order is created (the order re-validates everything inside its transaction).
  async previewCoupon(input: {
    tenantId: string;
    branchId: string;
    items: OrderCreationItemInput[];
    couponCode: string;
    customerId: string | null;
  }) {
    const priced = await this.priceItems(input.tenantId, input.items);
    const subtotalCents = priced.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
    const applied = await this.coupons.preview({
      tenantId: input.tenantId,
      branchId: input.branchId,
      code: normalizeCouponCode(input.couponCode),
      subtotalCents,
      customerId: input.customerId,
    });
    return {
      code: applied.code,
      discountType: applied.discountType,
      subtotalCents,
      discountCents: applied.discountCents,
      subtotalAfterDiscountCents: subtotalCents - applied.discountCents,
    };
  }

  private isIdempotencyKeyViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
    const target = error.meta?.target;
    return Array.isArray(target) ? target.includes('idempotencyKey') : String(target ?? '').includes('idempotencyKey');
  }

  private async findReplay(input: OrderCreationInput): Promise<OrderWithItems | null> {
    const existing = await this.prisma.order.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey! } },
      include: { items: true },
    });
    if (!existing) return null;

    const signature = (items: { productId: string; quantity: number }[]) =>
      items
        .map((item) => `${item.productId}:${item.quantity}`)
        .sort()
        .join('|');
    const sameRequest =
      existing.tabId === null &&
      existing.source === input.source &&
      existing.branchId === input.branchId &&
      existing.paymentMethod === input.paymentMethod &&
      existing.fulfillmentType === input.fulfillmentType &&
      existing.customerName === input.customerName &&
      existing.customerPhone === input.customerPhone &&
      existing.customerId === (input.customerId ?? null) &&
      existing.couponCode === (input.couponCode ?? null) &&
      signature(existing.items) === signature(input.items);
    if (!sameRequest) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta chave de idempotência já foi usada em outro pedido.',
      });
    }
    return existing;
  }

  async createPricedOrderInTx(tx: Prisma.TransactionClient, input: PricedOrderInput): Promise<OrderCreationResult> {
    const orderItemsData = input.items.map((item) => ({
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      subtotalCents: item.unitPriceCents * item.quantity,
    }));
    const subtotalCents = orderItemsData.reduce((sum, i) => sum + i.subtotalCents, 0);
    const isDelivery = input.fulfillmentType === 'DELIVERY';
    // Fase 10: the delivery fee and minimum order come from the BRANCH settings,
    // read here on the server — never from the request. The minimum is compared with the
    // items subtotal BEFORE any coupon discount, and the fee is never discounted.
    const { deliveryFeeCents } = isDelivery
      ? priceDelivery(subtotalCents, await this.readDeliverySettings(tx, input.tenantId, input.branchId))
      : { deliveryFeeCents: 0 };
    const isCashSale = !!input.recordCashSaleByUserId && input.paymentMethod === 'CASH';

    // Locked FIRST (FOR UPDATE): a concurrent close waits for this sale to
    // commit, so the closing balance always includes it; if no session is
    // OPEN the whole order is rejected with CASH_REGISTER_NOT_OPEN.
    const cashSessionId = isCashSale
      ? await this.cashRegister.lockOpenSessionForSale(tx, input.tenantId, input.branchId)
      : null;

    // Fase 11 (fatia 2): the coupon is resolved AFTER the cash-session lock (fixed lock order:
    // cash -> coupon) and BEFORE the order exists: the coupon row is locked FOR UPDATE and every
    // rule is re-evaluated on it. If anything below fails, this whole transaction rolls back
    // and the usage is never consumed. Orders without a coupon skip all of this.
    const couponCode = input.couponCode ? normalizeCouponCode(input.couponCode) || null : null;
    const applied = couponCode
      ? await this.coupons.applyInTx(tx, {
          tenantId: input.tenantId,
          branchId: input.branchId,
          code: couponCode,
          subtotalCents,
          customerId: input.customerId ?? null,
        })
      : null;
    const discountCents = applied?.discountCents ?? 0;
    // The single formula: total = subtotal - discount + delivery fee (never negative).
    let totalCents: number;
    try {
      totalCents = computeOrderTotalCents(subtotalCents, discountCents, deliveryFeeCents);
    } catch {
      throw orderTotalTooLarge();
    }

    const order = await tx.order.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        orderNumber: generateOrderNumber(),
        status: input.status ?? 'PENDING',
        source: input.source,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        customerId: input.customerId ?? null,
        fulfillmentType: input.fulfillmentType,
        paymentMethod: input.paymentMethod,
        notes: input.notes ?? undefined,
        street: isDelivery ? input.address!.street : undefined,
        number: isDelivery ? input.address!.number : undefined,
        complement: isDelivery ? input.address!.complement : undefined,
        neighborhood: isDelivery ? input.address!.neighborhood : undefined,
        city: isDelivery ? input.address!.city : undefined,
        state: isDelivery ? input.address!.state : undefined,
        zipCode: isDelivery ? input.address!.zipCode : undefined,
        subtotalCents,
        discountCents,
        couponId: applied?.couponId ?? null,
        couponCode: applied?.code ?? null,
        deliveryFeeCents,
        totalCents,
        tabId: input.tabId,
        idempotencyKey: input.idempotencyKey,
        items: { create: orderItemsData },
      },
      include: { items: true },
    });

    if (applied) {
      await this.coupons.consumeInTx(tx, applied, {
        tenantId: input.tenantId,
        orderId: order.id,
        customerId: input.customerId ?? null,
      });
    }

    // A DELIVERY order always has its operational record, created in the same
    // transaction (no DELIVERY order without a delivery, and vice versa).
    if (isDelivery) {
      await tx.delivery.create({
        data: {
          tenantId: input.tenantId,
          branchId: input.branchId,
          orderId: order.id,
          notes: normalizeNotes(input.deliveryNotes),
        },
      });
    }

    const movement = cashSessionId
      ? await this.cashRegister.recordSale(tx, {
          sessionId: cashSessionId,
          tenantId: input.tenantId,
          orderId: order.id,
          amountCents: order.totalCents,
          userId: input.recordCashSaleByUserId!,
        })
      : null;

    // Fase 09: an order that is BORN confirmed (table checkout -> COMPLETED)
    // consumes its recipes right here, in the same transaction as the Order,
    // the SALE cash movement and the payment. PENDING orders (online, PDV)
    // consume later, on the PENDING -> CONFIRMED transition (OrdersService).
    const stockMovements = statusConsumesStock(order.status)
      ? await this.inventory.consumeForOrderInTx(
          tx,
          { id: order.id, tenantId: order.tenantId, branchId: order.branchId, items: order.items },
          input.recordCashSaleByUserId ?? null,
        )
      : [];

    return { order, cashMovementId: movement?.id ?? null, stockMovementIds: stockMovements.map((m) => m.id) };
  }

  private async readDeliverySettings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
  ): Promise<DeliverySettings> {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { deliveryEnabled: true, deliveryFeeCents: true, deliveryMinOrderCents: true },
    });
    if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Unidade não encontrada.' });
    return {
      enabled: branch.deliveryEnabled,
      feeCents: branch.deliveryFeeCents,
      minOrderCents: branch.deliveryMinOrderCents,
    };
  }

  // Best-effort, never blocks the response — same AuditService as every
  // other module. Called only AFTER the transaction committed.
  async recordCreationAudit(result: OrderCreationResult, source: OrderSource, userId?: string) {
    const { order, cashMovementId, stockMovementIds } = result;
    await this.audit.record({
      tenantId: order.tenantId,
      action: 'ORDER_CREATED',
      entity: 'Order',
      entityId: order.id,
      afterData: {
        orderNumber: order.orderNumber,
        source,
        totalCents: order.totalCents,
        discountCents: order.discountCents,
        couponCode: order.couponCode,
        deliveryFeeCents: order.deliveryFeeCents,
        itemCount: order.items.length,
      },
    });
    if (cashMovementId) {
      await this.audit.record({
        tenantId: order.tenantId,
        userId,
        action: 'CASH_MOVEMENT_CREATED',
        entity: 'CashMovement',
        entityId: cashMovementId,
        afterData: { type: 'SALE', orderId: order.id, amountCents: order.totalCents },
      });
    }
    if (stockMovementIds.length > 0) {
      await this.audit.record({
        tenantId: order.tenantId,
        userId,
        action: 'INVENTORY_MOVEMENT_CREATED',
        entity: 'Order',
        entityId: order.id,
        afterData: { reason: 'ORDER_CONFIRMED', stockMovementIds },
      });
    }
  }
}
