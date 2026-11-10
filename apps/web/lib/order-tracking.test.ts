import { trackingHeading } from './order-tracking';

describe('trackingHeading (B18)', () => {
  it('follows the order from received to delivered', () => {
    expect(trackingHeading('PENDING').title).toBe('Pedido recebido!');
    expect(trackingHeading('PREPARING').title).toMatch(/em preparo/);
    expect(trackingHeading('READY').title).toMatch(/pronto/);
    expect(trackingHeading('OUT_FOR_DELIVERY').title).toMatch(/saiu para entrega/);
    expect(trackingHeading('DELIVERED').title).toBe('Pedido entregue!');
    expect(trackingHeading('COMPLETED').title).toBe('Pedido concluído!');
  });

  it('never says "recebido" for a cancelled order', () => {
    expect(trackingHeading('CANCELLED').title).toBe('Pedido cancelado');
  });

  it('reads an unknown status as received', () => {
    expect(trackingHeading('SOMETHING_NEW')).toEqual(trackingHeading('PENDING'));
  });
});
