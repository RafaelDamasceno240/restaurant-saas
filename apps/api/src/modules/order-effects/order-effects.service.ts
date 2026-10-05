import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LoyaltyService } from '../loyalty/loyalty.service';

type Tx = Prisma.TransactionClient;

export interface OrderEffectContext {
  tenantId: string;
  orderId: string;
  // Who caused the change (the user concluding, cancelling or linking). null = no user (never
  // the case today; kept so a future automatic conclusion has an honest value to record).
  actorUserId: string | null;
}

// What happens to a customer's benefits when something happens to an order. An order reaches a
// given state in more than one place (the generic status endpoint, the delivery flow, a table
// checkout that is born concluded, a customer linked afterwards); each of those places calls
// ONE method here, inside its own transaction, instead of knowing about every benefit module.
// So "the order was concluded" and "the points were credited" commit or roll back together.
//
// Callers already hold the order row lock (or have just created the order), which serializes
// everything below per order. Each benefit locks its own account AFTER that: order -> loyalty
// account. The same order everywhere, so no deadlock cycle.
@Injectable()
export class OrderEffectsService {
  constructor(private readonly loyalty: LoyaltyService) {}

  // The order just became COMPLETED or DELIVERED (or was created that way), or a customer was
  // just linked to an order already in that state.
  async onOrderConcludedInTx(tx: Tx, context: OrderEffectContext): Promise<void> {
    await this.loyalty.earnForOrderInTx(tx, context);
  }

  // Before an order's customer is changed or removed: refuse while a benefit credited for the
  // order is still standing with the current customer.
  async assertCustomerCanChangeInTx(tx: Tx, orderId: string): Promise<void> {
    await this.loyalty.assertOrderCustomerCanChangeInTx(tx, orderId);
  }
}
