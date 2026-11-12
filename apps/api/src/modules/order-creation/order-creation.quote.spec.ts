import { BadRequestException } from '@nestjs/common';
import { OrderCreationService } from './order-creation.service';

// Add-ons in the staff flows (PDV and table rounds): the server prices every line from the
// product row and its OWN option groups, and the required groups are checked for every channel.
describe('OrderCreationService.quoteItems / priceItems (adicionais no PDV e nas comandas)', () => {
  const bacon = { id: 'o-bacon', name: 'Bacon', priceCents: 500, maxQuantity: 3, active: true, soldOut: false, tenantId: 't1' };
  const cheddar = { id: 'o-cheddar', name: 'Cheddar', priceCents: 400, maxQuantity: 1, active: true, soldOut: true, tenantId: 't1' };
  const malPassado = { id: 'o-mal', name: 'Mal passado', priceCents: 0, maxQuantity: 1, active: true, soldOut: false, tenantId: 't1' };
  const product = {
    id: 'p-burger',
    name: 'X-Burger',
    priceCents: 2500,
    optionGroups: [
      { group: { id: 'g-ponto', name: 'Ponto da carne', minSelect: 1, maxSelect: 1, active: true, options: [malPassado] } },
      { group: { id: 'g-extra', name: 'Adicionais', minSelect: 0, maxSelect: 4, active: true, options: [bacon, cheddar] } },
    ],
  };
  const plain = { id: 'p-suco', name: 'Suco', priceCents: 850, optionGroups: [] };

  function build(products: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(products);
    const service = new OrderCreationService(
      { product: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, findMany };
  }

  it('prices a product without add-ons at its own price', async () => {
    const { service } = build([plain]);
    const quote = await service.quoteItems('t1', [{ productId: 'p-suco', quantity: 2 }]);
    expect(quote).toEqual({
      subtotalCents: 1700,
      items: [
        {
          productId: 'p-suco',
          name: 'Suco',
          quantity: 2,
          basePriceCents: 850,
          extrasCents: 0,
          unitPriceCents: 850,
          subtotalCents: 1700,
          notes: null,
          options: [],
        },
      ],
    });
  });

  it('adds every add-on of each unit, in cents, and keeps the note', async () => {
    const { service } = build([product]);
    const quote = await service.quoteItems('t1', [
      {
        productId: 'p-burger',
        quantity: 3,
        notes: '  sem cebola ',
        options: [
          { optionId: 'o-mal', quantity: 1 },
          { optionId: 'o-bacon', quantity: 2 },
        ],
      },
    ]);
    const [line] = quote.items;
    expect(line.basePriceCents).toBe(2500);
    expect(line.extrasCents).toBe(1000);
    expect(line.unitPriceCents).toBe(3500);
    expect(line.subtotalCents).toBe(10500);
    expect(line.notes).toBe('sem cebola');
    expect(line.options).toEqual([
      { optionId: 'o-mal', group: 'Ponto da carne', name: 'Mal passado', unitPriceCents: 0, quantity: 1 },
      { optionId: 'o-bacon', group: 'Adicionais', name: 'Bacon', unitPriceCents: 500, quantity: 2 },
    ]);
    expect(quote.subtotalCents).toBe(10500);
  });

  it('refuses a missing required group (also for staff sales now)', async () => {
    const { service } = build([product]);
    await expect(service.priceItems('t1', [{ productId: 'p-burger', quantity: 1 }])).rejects.toMatchObject({
      response: { code: 'OPTION_REQUIRED' },
    });
  });

  it('refuses a sold-out add-on and one of another product', async () => {
    const { service } = build([product, plain]);
    const soldOut = service.quoteItems('t1', [
      { productId: 'p-burger', quantity: 1, options: [{ optionId: 'o-mal', quantity: 1 }, { optionId: 'o-cheddar', quantity: 1 }] },
    ]);
    await expect(soldOut).rejects.toMatchObject({ response: { code: 'OPTION_UNAVAILABLE' } });
    const foreign = service.quoteItems('t1', [{ productId: 'p-suco', quantity: 1, options: [{ optionId: 'o-bacon', quantity: 1 }] }]);
    await expect(foreign).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses more units of an add-on than allowed', async () => {
    const { service } = build([product]);
    const tooMany = service.quoteItems('t1', [
      { productId: 'p-burger', quantity: 1, options: [{ optionId: 'o-mal', quantity: 1 }, { optionId: 'o-bacon', quantity: 4 }] },
    ]);
    await expect(tooMany).rejects.toMatchObject({ response: { code: 'OPTION_LIMIT' } });
  });

  it('reads only this tenant\'s active products that are not sold out', async () => {
    const { service, findMany } = build([plain]);
    await service.quoteItems('t1', [{ productId: 'p-suco', quantity: 1 }]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['p-suco'] }, tenantId: 't1', active: true, soldOut: false } }),
    );
  });

  it('answers the caller\'s own "unavailable" message and can leave the unit limit to the caller', async () => {
    const { service } = build([]);
    await expect(
      service.priceItems('t1', [{ productId: 'p-x', quantity: 1 }], { enforceRequiredOptions: true, unavailableMessage: 'da rodada' }),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_UNAVAILABLE', message: 'da rodada' } });

    const { service: withPlain } = build([plain]);
    const lines = [{ productId: 'p-suco', quantity: 30 }, { productId: 'p-suco', quantity: 30 }];
    await expect(withPlain.priceItems('t1', lines)).rejects.toMatchObject({ response: { code: 'QUANTITY_LIMIT' } });
    await expect(withPlain.priceItems('t1', lines, { enforceRequiredOptions: true, skipUnitLimit: true })).resolves.toHaveLength(2);
  });
});
