import {
  boldSegments,
  cartFromShared,
  contactLabel,
  failureReason,
  formatWaId,
  replyBlock,
  validateReply,
} from './whatsapp-logic';
import type { SharedCart } from './whatsapp-api';

describe('whatsapp-logic', () => {
  it('formats WhatsApp ids and falls back to the number when there is no name', () => {
    expect(formatWaId('5511987654321')).toBe('+55 (11) 98765-4321');
    expect(formatWaId('551134567890')).toBe('+55 (11) 3456-7890');
    expect(formatWaId('15550001111')).toBe('+15550001111');
    expect(contactLabel({ name: '  ', waId: '5511987654321' })).toBe('+55 (11) 98765-4321');
    expect(contactLabel({ name: 'Ana', waId: '5511987654321' })).toBe('Ana');
  });

  it('says why a reply is not possible and validates the text', () => {
    expect(replyBlock({ windowOpen: true, contact: { optedOut: false } })).toBeNull();
    expect(replyBlock({ windowOpen: false, contact: { optedOut: false } })).toContain('24 horas');
    expect(replyBlock({ windowOpen: true, contact: { optedOut: true } })).toContain('não receber');
    expect(validateReply('   ')).toBe('Escreva a mensagem.');
    expect(validateReply('x'.repeat(1001))).toContain('1000');
    expect(validateReply(' oi ')).toBeNull();
    expect(failureReason({ status: 'FAILED', errorCode: 'WINDOW_CLOSED' })).toContain('24 horas');
    expect(failureReason({ status: 'FAILED', errorCode: 'X' })).toBe('falha no envio');
    expect(failureReason({ status: 'SENT', errorCode: null })).toBeNull();
  });

  it('renders *bold* as segments, never as HTML', () => {
    expect(boldSegments('Olá *Ana*, total <b>R$ 9,50</b>')).toEqual([
      { text: 'Olá ', bold: false },
      { text: 'Ana', bold: true },
      { text: ', total <b>R$ 9,50</b>', bold: false },
    ]);
  });

  it('turns a checkout link cart into the public cart, without the unavailable lines', () => {
    const shared: SharedCart = {
      restaurant: { name: 'Burger Teste', slug: 'burger-teste' },
      expiresAt: '2026-11-12T22:00:00.000Z',
      subtotalCents: 6200,
      items: [
        {
          productId: 'p1',
          name: 'Smash',
          quantity: 2,
          unitPriceCents: 3100,
          options: [
            {
              optionId: 'o1',
              groupName: 'Turbine',
              name: 'Bacon extra',
              priceCents: 500,
              quantity: 1,
            },
          ],
          notes: 'sem cebola',
          available: true,
          problem: null,
        },
        {
          productId: 'p2',
          name: 'Batata',
          quantity: 1,
          unitPriceCents: 0,
          options: [],
          notes: null,
          available: false,
          problem: 'Esgotado',
        },
      ],
    };
    const cart = cartFromShared(shared);
    expect(cart).toMatchObject({ restaurantSlug: 'burger-teste', restaurantName: 'Burger Teste' });
    expect(cart.items).toEqual([
      {
        lineId: 'p1|o1x1|sem cebola',
        productId: 'p1',
        name: 'Smash',
        priceCents: 3100,
        imageUrl: null,
        quantity: 2,
        options: [
          {
            optionId: 'o1',
            groupName: 'Turbine',
            name: 'Bacon extra',
            priceCents: 500,
            quantity: 1,
          },
        ],
        notes: 'sem cebola',
      },
    ]);
  });
});
