import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { PosOrdersService } from './pos-orders.service';

// Customer linking in the PDV (Fase 11). The HTTP-level cases live in
// test/customers-orders.e2e-spec.ts; this covers the permission gate, which cannot be
// exercised end to end without editing the shared role matrix.
describe('PosOrdersService customer linking', () => {
  const user = (permissions: string[]): AuthenticatedRequestUser => ({
    userId: 'u1',
    tenantId: 'tenant-1',
    email: 'x@example.com',
    roles: ['CASHIER'],
    permissions,
  });
  const dto = (extra: object = {}) => ({
    branchId: 'b1',
    items: [{ productId: 'p1', quantity: 1 }],
    paymentMethod: 'PIX' as const,
    ...extra,
  });

  function build(customer: { id: string; name: string; phone: string; active: boolean } | null) {
    const findFirst = jest.fn().mockResolvedValue(customer);
    const createOrder = jest.fn().mockResolvedValue({ id: 'o1' });
    const service = new PosOrdersService(
      { createOrder } as never,
      { findOneForTenant: jest.fn().mockResolvedValue({ id: 'o1' }) } as never,
      { assertAccess: jest.fn().mockResolvedValue(undefined) } as never,
      { customer: { findFirst } } as never,
    );
    return { service, findFirst, createOrder };
  }

  it('does not touch the registry when no customer is given', async () => {
    const { service, findFirst, createOrder } = build(null);
    await service.createOrder(user(['pos.create']), dto({ customerName: 'Balcão' }) as never);
    expect(findFirst).not.toHaveBeenCalled();
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ customerId: null, customerName: 'Balcão' }));
  });

  it('refuses to link without customers.read, before any lookup', async () => {
    const { service, findFirst, createOrder } = build({ id: 'c1', name: 'Ana', phone: '11987654321', active: true });
    await expect(service.createOrder(user(['pos.create']), dto({ customerId: 'c1' }) as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('looks the customer up inside the caller tenant and treats a miss as 404', async () => {
    const { service, findFirst, createOrder } = build(null);
    await expect(service.createOrder(user(['pos.create', 'customers.read']), dto({ customerId: 'c1' }) as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1', tenantId: 'tenant-1' } }));
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('refuses an inactive customer', async () => {
    const { service, createOrder } = build({ id: 'c1', name: 'Ana', phone: '11987654321', active: false });
    await expect(service.createOrder(user(['pos.create', 'customers.read']), dto({ customerId: 'c1' }) as never)).rejects.toBeInstanceOf(ConflictException);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('links an active customer, using its name/phone only as the default snapshot', async () => {
    const { service, createOrder } = build({ id: 'c1', name: 'Ana', phone: '11987654321', active: true });
    await service.createOrder(user(['pos.create', 'customers.read']), dto({ customerId: 'c1' }) as never);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', customerId: 'c1', customerName: 'Ana', customerPhone: '11987654321' }),
    );
    await service.createOrder(user(['pos.create', 'customers.read']), dto({ customerId: 'c1', customerName: 'Outro' }) as never);
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ customerName: 'Outro', customerPhone: '11987654321' }));
  });
});
