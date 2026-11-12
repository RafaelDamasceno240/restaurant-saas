import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FulfillmentType,
  Order,
  OrderItem,
  OrderItemOption,
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
import { OrderEffectsService } from '../order-effects/order-effects.service';
import { CashbackService } from '../cashback/cashback.service';
import { isCashbackError } from '../cashback/cashback-errors';
import { onAccountDisabled } from '../../common/util/payment-methods';
import { isConcludedOrderStatus } from '../../common/util/order-conclusion.util';
import { MAX_UNITS_PER_PRODUCT, productOverUnitLimit } from '../../common/util/item-quantity.util';
import {
  ChosenOption,
  PricedOption,
  normalizeLineNote,
  optionsSignature,
  priceOptions,
} from './option-pricing';

// Orders that use the SAME limited coupon queue on its row lock, each holding a pooled
// connection while it waits. Prisma's defaults (5 s to finish, 2 s to get a connection) are tuned
// for short uncontended transactions; a burst on one coupon could run past them and surface as
// a 500 even though nothing is wrong. Same budget the other transactional modules use.
const ORDER_TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

export interface OrderCreationItemInput {
  productId: string;
  quantity: number;
  // Add-ons for EACH unit of the line (ids and quantities only; priced by priceItems).
  options?: ChosenOption[];
  // The customer's note for this line ("sem cebola").
  notes?: string | null;
}

// How priceItems treats the add-ons. The public checkout offers them and must satisfy every
// required group; the PDV does not offer them yet (the product is sold at its base price).
export interface PriceItemsOptions {
  enforceRequiredOptions: boolean;
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
  // Order). Online CASH (pay on delivery/pickup) does not touch the drawer
  // here: it enters it when the order is concluded (B3, CashRegisterService).
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
  // Fase 11 (fatia 5): how much of the linked customer's cashback balance pays for this order,
  // in cents. Only ever set by the staff flows (PDV, table checkout) after checking cashback.use;
  // the public checkout never sets it. The amount is validated here against the customer's
  // LOCKED balance, inside the order transaction: asking for more than the balance or more than
  // the items cost refuses the whole order.
  cashbackToUseCents?: number | null;
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
  // B9: the tab item this line bills (table checkout only; UNIQUE in the database).
  tabItemId?: string;
  // unitPriceCents already includes these (see option-pricing.ts).
  options?: PricedOption[];
  notes?: string | null;
}

export interface PricedOrderInput extends Omit<OrderCreationInput, 'items'> {
  items: PricedOrderItem[];
  status?: OrderStatus;
  tabId?: string;
  idempotencyKey?: string;
  // B9: the caller has already dealt with the stock of these items (the table checkout: each round
  // consumed its recipes when it was sent to the kitchen), so an order born concluded consumes
  // nothing here. Every other caller leaves it unset and nothing changes for them.
  stockHandledByCaller?: boolean;
}

export type OrderWithItems = Order & { items: (OrderItem & { options: OrderItemOption[] })[] };

// Every read of an order this service returns carries its lines with their add-ons.
const ITEMS_WITH_OPTIONS = { items: { include: { options: true } } } as const;

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
    private readonly effects: OrderEffectsService,
    private readonly cashback: CashbackService,
  ) {}

  async createOrder(rawInput: OrderCreationInput): Promise<OrderWithItems> {
    // Selling on account (fiado) is off for every channel, whatever a caller sends.
    if (rawInput.paymentMethod === 'ON_ACCOUNT') throw onAccountDisabled();
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

    const pricedItems = await this.priceItems(input.tenantId, input.items, {
      enforceRequiredOptions: input.source === 'ONLINE',
    });

    let result: OrderCreationResult;
    try {
      result = await this.prisma.$transaction(
        (tx) => this.createPricedOrderInTx(tx, { ...input, items: pricedItems }),
        ORDER_TRANSACTION_OPTIONS,
      );
    } catch (error) {
      // A duplicate of an in-flight request loses the race in one of two ways: it reaches the
      // order insert and collides on the idempotency key, or - with a limited coupon - it waits
      // for the coupon lock, then finds the usage already taken by the WINNER (its twin) - and the
      // same happens with the cashback balance its twin has just spent. In all these
      // cases the request is a replay, so it gets the original order (findReplay re-checks that
      // it really is the same request) and never a spurious "coupon used up".
      if (
        input.idempotencyKey &&
        (this.isIdempotencyKeyViolation(error) || isCouponError(error) || isCashbackError(error))
      ) {
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
  // OrderCreationItemInput only ever carries productId + quantity (+ option ids and quantities).
  // Shared by the order and by the coupon preview, so both always price the basket the same way.
  // A product marked "sold out" is unavailable too, and so is an add-on that is not one of the
  // product's own (another product's, another tenant's, inactive or sold out).
  async priceItems(
    tenantId: string,
    items: OrderCreationItemInput[],
    { enforceRequiredOptions }: PriceItemsOptions = { enforceRequiredOptions: false },
  ): Promise<PricedOrderItem[]> {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, tenantId, active: true, soldOut: false },
      include: {
        optionGroups: {
          where: { tenantId, group: { tenantId } },
          orderBy: { displayOrder: 'asc' },
          include: {
            group: {
              include: {
                options: {
                  where: { tenantId },
                  orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
                },
              },
            },
          },
        },
      },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const unavailable = items.find((item) => !productById.has(item.productId));
    if (unavailable) {
      throw new BadRequestException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'Um ou mais produtos do pedido não estão mais disponíveis.',
      });
    }

    // B7: the DTO caps each line; the same product repeated over several lines is added up here.
    const overLimit = productOverUnitLimit(items);
    if (overLimit) {
      throw new BadRequestException({
        code: 'QUANTITY_LIMIT',
        message: `No máximo ${MAX_UNITS_PER_PRODUCT} unidades de "${productById.get(overLimit)!.name}" por pedido.`,
      });
    }

    return items.map((item) => {
      const product = productById.get(item.productId)!;
      const priced = priceOptions(
        product.name,
        product.optionGroups.map((link) => link.group),
        item.options ?? [],
        enforceRequiredOptions,
      );
      if (!priced.ok) throw new BadRequestException(priced.error);
      return {
        productId: product.id,
        productNameSnapshot: product.name,
        unitPriceCents: product.priceCents + priced.extraCents,
        quantity: item.quantity,
        options: priced.options,
        notes: normalizeLineNote(item.notes),
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
    enforceRequiredOptions?: boolean;
  }) {
    const priced = await this.priceItems(input.tenantId, input.items, {
      enforceRequiredOptions: input.enforceRequiredOptions ?? false,
    });
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
      include: ITEMS_WITH_OPTIONS,
    });
    if (!existing) return null;

    // A line is its product, its quantity, its add-ons and its note.
    const signature = (
      items: {
        productId: string;
        quantity: number;
        notes?: string | null;
        options: { optionItemId: string | null; quantity: number }[];
      }[],
    ) =>
      items
        .map(
          (item) =>
            `${item.productId}:${item.quantity}:${optionsSignature(item.options)}:${item.notes ?? ''}`,
        )
        .sort()
        .join('|');
    const requested = input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      notes: normalizeLineNote(item.notes),
      // The same option sent twice was stored once, with the quantities added up.
      options: [
        ...(item.options ?? []).reduce(
          (sum, o) => sum.set(o.optionId, (sum.get(o.optionId) ?? 0) + o.quantity),
          new Map<string, number>(),
        ),
      ].map(([optionItemId, quantity]) => ({ optionItemId, quantity })),
    }));
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
      existing.cashbackUsedCents === (input.cashbackToUseCents ?? 0) &&
      signature(existing.items) === signature(requested);
    if (!sameRequest) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta chave de idempotência já foi usada em outro pedido.',
      });
    }
    return existing;
  }

  async createPricedOrderInTx(tx: Prisma.TransactionClient, input: PricedOrderInput): Promise<OrderCreationResult> {
    // Same rule as createOrder, for the callers that come straight here (table checkout).
    if (input.paymentMethod === 'ON_ACCOUNT') throw onAccountDisabled();
    const orderItemsData = input.items.map((item) => ({
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      subtotalCents: item.unitPriceCents * item.quantity,
      tabItemId: item.tabItemId ?? null,
      notes: item.notes ?? null,
      options: { create: item.options ?? [] },
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

    // Fase 11 (fatia 5): cashback is reserved AFTER the coupon (fixed lock order: cash -> coupon
    // -> cashback account) and BEFORE the order exists: the customer's account is locked FOR
    // UPDATE and the requested amount is checked against the balance it really has and against
    // what the items cost after the coupon. The debit itself is written right after the order
    // is created, below, in this same transaction. Orders without cashback skip all of this.
    const reservation =
      input.cashbackToUseCents && input.cashbackToUseCents > 0
        ? await this.cashback.reserveUseInTx(tx, {
            tenantId: input.tenantId,
            customerId: input.customerId ?? null,
            branchId: input.branchId,
            requestedCents: input.cashbackToUseCents,
            subtotalCents,
            discountCents,
            actorUserId: input.recordCashSaleByUserId ?? null,
          })
        : null;
    const cashbackUsedCents = reservation?.amountCents ?? 0;

    // The single formula: total = subtotal - discount - cashback + delivery fee (never negative).
    let totalCents: number;
    try {
      totalCents = computeOrderTotalCents(subtotalCents, discountCents, deliveryFeeCents, cashbackUsedCents);
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
        cashbackUsedCents,
        couponId: applied?.couponId ?? null,
        couponCode: applied?.code ?? null,
        deliveryFeeCents,
        totalCents,
        tabId: input.tabId,
        idempotencyKey: input.idempotencyKey,
        items: { create: orderItemsData },
      },
      include: ITEMS_WITH_OPTIONS,
    });

    if (applied) {
      await this.coupons.consumeInTx(tx, applied, {
        tenantId: input.tenantId,
        orderId: order.id,
        customerId: input.customerId ?? null,
      });
    }

    // The cashback debit points at the order it paid for: no order without its debit, no debit
    // without its order.
    if (reservation) {
      await this.cashback.commitUseInTx(tx, reservation, order.id);
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

    // An order that is BORN concluded (table checkout) credits its benefits right here, in the
    // same transaction as everything else. Orders born PENDING are credited when they conclude
    // (OrdersService / DeliveryService).
    //
    // BEFORE the stock, on purpose. Every flow locks the customer's accounts (cashback, credit,
    // loyalty) before the stock balances: a cancellation gives cashback back and only then
    // returns the ingredients. Taking the stock first here would be the opposite order, and a
    // table bill and a cancellation of the same customer over the same ingredient could wait
    // for each other forever (PostgreSQL would abort one of them with a deadlock).
    if (isConcludedOrderStatus(order.status)) {
      await this.effects.onOrderConcludedInTx(tx, {
        tenantId: order.tenantId,
        orderId: order.id,
        actorUserId: input.recordCashSaleByUserId ?? null,
      });
    }

    // Fase 09: an order that is BORN confirmed consumes its recipes right here, in the same
    // transaction as the Order, the SALE cash movement and the payment - unless the caller already
    // took care of the stock (B9: the table checkout, whose rounds consumed their recipes when they
    // were sent to the kitchen). PENDING orders (online, PDV) consume later, on the
    // PENDING -> CONFIRMED transition (OrdersService).
    // Last: the stock balances are always locked after the customer's accounts (see above).
    const stockMovements = statusConsumesStock(order.status) && !input.stockHandledByCaller
      ? await this.inventory.consumeForOrderInTx(
          tx,
          { id: order.id, tenantId: order.tenantId, branchId: order.branchId, items: order.items },
          input.recordCashSaleByUserId ?? null,
        )
      : [];

    // B2: an order born PENDING consumes nothing now, but it is only taken if the stock can
    // still cover it together with every other PENDING order of the branch (balances locked,
    // so two orders cannot both take the last units). Also last: same lock order as above.
    if (order.status === 'PENDING') {
      await this.inventory.assertAvailableForNewPendingOrderInTx(tx, {
        id: order.id,
        tenantId: order.tenantId,
        branchId: order.branchId,
        items: order.items,
      });
    }

    return { order, cashMovementId: movement?.id ?? null, stockMovementIds: stockMovements.map((m) => m.id) };
  }

  private async readDeliverySettings(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
  ): Promise<DeliverySettings> {
    const branch = await tx.branch.findFirst({
      where: { id: branchId, tenantId },
      select: {
        deliveryEnabled: true,
        deliveryFeeCents: true,
        deliveryMinOrderCents: true,
        deliveryFreeAboveCents: true,
      },
    });
    if (!branch) throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Unidade não encontrada.' });
    return {
      enabled: branch.deliveryEnabled,
      feeCents: branch.deliveryFeeCents,
      minOrderCents: branch.deliveryMinOrderCents,
      freeAboveCents: branch.deliveryFreeAboveCents,
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
        cashbackUsedCents: order.cashbackUsedCents,
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
