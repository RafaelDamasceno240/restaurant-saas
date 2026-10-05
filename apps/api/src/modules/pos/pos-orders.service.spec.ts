import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CustomerLookupService } from '../customers/customer-lookup.service';
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
      // The real lookup (the rule under test lives there since it is shared with the table
      // checkout and the order link), over a stubbed database.
      new CustomerLookupService({ customer: { findFirst } } as never),
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

  it('refuses to spend cashback without cashback.use, before any lookup or sale', async () => {
    const { service, findFirst, createOrder } = build({ id: 'c1', name: 'Ana', phone: '11987654321', active: true });
    await expect(
      service.createOrder(user(['pos.create', 'customers.read']), dto({ customerId: 'c1', cashbackToUseCents: 500 }) as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('passes the requested cashback on, and null when none was asked for', async () => {
    const { service, createOrder } = build({ id: 'c1', name: 'Ana', phone: '11987654321', active: true });
    const allowed = user(['pos.create', 'customers.read', 'cashback.use']);
    await service.createOrder(allowed, dto({ customerId: 'c1', cashbackToUseCents: 500 }) as never);
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ customerId: 'c1', cashbackToUseCents: 500 }));
    await service.createOrder(allowed, dto({ customerId: 'c1' }) as never);
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ cashbackToUseCents: null }));
  });

  it('refuses to sell on account without receivables.sell, before any lookup or sale', async () => {
    const { service, findFirst, createOrder } = build({ id: 'c1', name: 'Ana', phone: '11987654321', active: true });
    await expect(
      service.createOrder(user(['pos.create', 'customers.read']), dto({ customerId: 'c1', paymentMethod: 'ON_ACCOUNT' }) as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('passes the credit terms on only for a sale on account', async () => {
    const { service, createOrder } = build({ id: 'c1', name: 'Ana', phone: '11987654321', active: true });
    const allowed = user(['pos.create', 'customers.read', 'receivables.sell']);
    const creditTerms = { installments: 2, firstDueDate: '2026-11-05' };
    await service.createOrder(allowed, dto({ customerId: 'c1', paymentMethod: 'ON_ACCOUNT', creditTerms }) as never);
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ paymentMethod: 'ON_ACCOUNT', creditTerms }));
    await service.createOrder(allowed, dto({ customerId: 'c1', paymentMethod: 'ON_ACCOUNT' }) as never);
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ paymentMethod: 'ON_ACCOUNT', creditTerms: null }));
    // Terms sent with a sale that is paid now are dropped, and that sale needs no extra permission.
    await service.createOrder(user(['pos.create', 'customers.read']), dto({ customerId: 'c1', creditTerms }) as never);
    expect(createOrder).toHaveBeenLastCalledWith(expect.objectContaining({ paymentMethod: 'PIX', creditTerms: null }));
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

// Coupons in the PDV (Fase 11, slice 2). The HTTP-level cases live in test/coupons-orders.e2e-spec.ts;
// this covers the permission gate, which cannot be exercised end to end for "has pos.create but not
// coupons.apply" without editing the shared role matrix.
describe('PosOrdersService coupon permission', () => {
  const user = (permissions: string[]): AuthenticatedRequestUser => ({
    userId: 'u1',
    tenantId: 'tenant-1',
    email: 'x@example.com',
    roles: ['MANAGER'],
    permissions,
  });
  const dto = (extra: object = {}) => ({
    branchId: 'b1',
    items: [{ productId: 'p1', quantity: 1 }],
    paymentMethod: 'PIX' as const,
    ...extra,
  });

  function build() {
    const createOrder = jest.fn().mockResolvedValue({ id: 'o1' });
    const previewCoupon = jest.fn().mockResolvedValue({ discountCents: 100 });
    const assertAccess = jest.fn().mockResolvedValue(undefined);
    const service = new PosOrdersService(
      { createOrder, previewCoupon } as never,
      { findOneForTenant: jest.fn().mockResolvedValue({ id: 'o1' }) } as never,
      { assertAccess } as never,
      { customer: { findFirst: jest.fn() } } as never,
    );
    return { service, createOrder, previewCoupon, assertAccess };
  }

  it('refuses a coupon without coupons.apply, before the order service is reached', async () => {
    const { service, createOrder } = build();
    await expect(
      service.createOrder(user(['pos.create']), dto({ couponCode: 'PROMO10' }) as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('an order without a coupon does not need coupons.apply', async () => {
    const { service, createOrder } = build();
    await service.createOrder(user(['pos.create']), dto() as never);
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ couponCode: null }));
  });

  it('passes only the typed code on, together with the tenant taken from the user', async () => {
    const { service, createOrder } = build();
    await service.createOrder(user(['pos.create', 'coupons.apply']), dto({ couponCode: 'PROMO10' }) as never);
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', couponCode: 'PROMO10' }));
  });

  it('the preview needs coupons.apply and checks the branch before pricing anything', async () => {
    const { service, previewCoupon, assertAccess } = build();
    const body = { branchId: 'b1', items: [{ productId: 'p1', quantity: 1 }], code: 'PROMO10' };
    await expect(service.previewCoupon(user(['pos.create']), body as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertAccess).not.toHaveBeenCalled();
    expect(previewCoupon).not.toHaveBeenCalled();

    await service.previewCoupon(user(['coupons.apply']), body as never);
    expect(assertAccess).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1' }), 'b1');
    expect(previewCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', branchId: 'b1', couponCode: 'PROMO10', customerId: null }),
    );
  });
});
