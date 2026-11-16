import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { customerInactive, customerNotFound } from './customer-errors';
import { normalizePhone } from './customer-input';

export interface LinkableCustomer {
  id: string;
  name: string;
  phone: string;
  active: boolean;
}

// The ONE definition of "may this user attach this customer to a sale", shared by every flow
// that links a customer to an order (PDV, table checkout, linking an existing order):
//   - the caller needs customers.read (they must be allowed to see who the customer is);
//   - the customer belongs to the caller's tenant (another tenant's id is a plain 404);
//   - the customer is active (an inactive one keeps its history but takes no new order).
// The customer id is the only thing a client sends; name and phone always come from here.
@Injectable()
export class CustomerLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForOrder(user: AuthenticatedRequestUser, customerId: string): Promise<LinkableCustomer> {
    this.assertCanLink(user);
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: user.tenantId },
      select: { id: true, name: true, phone: true, active: true },
    });
    if (!customer) throw customerNotFound();
    if (!customer.active) throw customerInactive();
    return customer;
  }

  // Active customers of the tenant whose registered phone is the one typed on an order. Only a
  // SUGGESTION for the staff to confirm: an order is never attributed to a customer by phone
  // coincidence alone (anyone can type any phone on the public checkout).
  async suggestByPhone(user: AuthenticatedRequestUser, rawPhone: string | null): Promise<LinkableCustomer[]> {
    this.assertCanLink(user);
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!phone) return [];
    return this.prisma.customer.findMany({
      where: { tenantId: user.tenantId, phone, active: true },
      select: { id: true, name: true, phone: true, active: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 5,
    });
  }

  // Also the gate for REMOVING a link: only someone who may see customers changes who an order
  // belongs to.
  assertCanLink(user: AuthenticatedRequestUser): void {
    if (!user.permissions.includes('customers.read')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem permissão para vincular clientes.' });
    }
  }
}
