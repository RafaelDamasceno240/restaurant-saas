import { Injectable } from '@nestjs/common';
import { PaymentMethod, Prisma } from '@prisma/client';

export interface InternalPaymentInput {
  tenantId: string;
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
}

// Fatia 10: the only provider today is INTERNAL — money taken at the table/
// counter and confirmed by staff, no external call. A future gateway adds a
// method that creates the Payment as PENDING (with externalId) and a webhook
// handler that flips it to CONFIRMED; the Payment model already has those
// columns, so the table checkout flow doesn't need to change shape for it.
@Injectable()
export class PaymentsService {
  // Runs inside the caller's transaction. Payment.orderId is UNIQUE: a
  // second payment for the same Order is rejected by the database itself.
  recordInternalConfirmed(tx: Prisma.TransactionClient, input: InternalPaymentInput) {
    return tx.payment.create({
      data: {
        tenantId: input.tenantId,
        orderId: input.orderId,
        method: input.method,
        status: 'CONFIRMED',
        provider: 'INTERNAL',
        amountCents: input.amountCents,
        confirmedAt: new Date(),
      },
    });
  }
}
