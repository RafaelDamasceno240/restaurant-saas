import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StrictValidationPipe } from '../pipes/strict-validation.pipe';
import { friendlyMessage } from '../filters/http-exception.filter';
import { CreateOrderDto } from '../../modules/public-orders/dto/create-order.dto';
import { CreatePosOrderDto } from '../../modules/pos/dto/create-pos-order.dto';
import { fieldLabel } from './validation-messages';

const PRODUCT = '6f1c2c1e-6d0e-4f4a-9a57-2f3a0a1b9c11';
const pipe = new StrictValidationPipe(new Reflector());

async function refusal(metatype: new () => unknown, value: unknown) {
  try {
    await pipe.transform(value, { type: 'body', metatype });
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as {
      code: string;
      message: string;
      details: { field: string; message: string }[];
    };
  }
  throw new Error('expected a validation error');
}

const ENGLISH = /must|should|longer|shorter|greater|less than|property|each value/i;
const checkout = (overrides: Record<string, unknown> = {}) => ({
  restaurantSlug: 'doce-hamburgueria',
  items: [{ productId: PRODUCT, quantity: 1 }],
  customer: { name: 'Ana', phone: '11987654321' },
  fulfillmentType: 'PICKUP',
  paymentMethod: 'PIX',
  ...overrides,
});

describe('validation messages in Portuguese (B8)', () => {
  it('the checkout example of the pilot: short name, in Portuguese, naming the field, with the code kept', async () => {
    const res = await refusal(CreateOrderDto, checkout({ customer: { name: 'A', phone: '11987654321' } }));
    expect(res.code).toBe('VALIDATION_ERROR');
    expect(res.message).toBe('Nome do cliente: use pelo menos 2 caracteres.');
    expect(res.details).toEqual([{ field: 'customer.name', message: 'Nome do cliente: use pelo menos 2 caracteres.' }]);
  });

  it('phone, address and payment: never English, and messages the DTO writes in Portuguese are kept', async () => {
    const res = await refusal(
      CreateOrderDto,
      checkout({
        customer: { name: 'Ana', phone: 'abc' },
        fulfillmentType: 'DELIVERY',
        address: { number: '10', neighborhood: 'Centro', city: 'SP', state: 'SPX', zipCode: '123' },
        paymentMethod: 'BITCOIN',
      }),
    );
    const messages = res.details.map((d) => d.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Telefone em formato inválido.',
        'Rua do endereço: campo obrigatório.',
        'UF do endereço: use no máximo 2 caracteres.',
        'CEP em formato inválido.',
        'Forma de pagamento: opção inválida.',
      ]),
    );
    for (const message of messages) expect(message).not.toMatch(ENGLISH);
    expect(res.message).not.toMatch(ENGLISH);
    expect(res.message).toMatch(/\(e mais \d+\)\.$/);
  });

  it('quantity limit, empty cart and an unknown product in the PDV', async () => {
    const over = await refusal(CreatePosOrderDto, {
      branchId: PRODUCT,
      paymentMethod: 'PIX',
      items: [{ productId: PRODUCT, quantity: 1 }, { productId: 'x', quantity: 51 }],
    });
    expect(over.details).toEqual(
      expect.arrayContaining([
        { field: 'items.1.productId', message: 'Produto do item 2: item não encontrado.' },
        { field: 'items.1.quantity', message: 'No máximo 50 unidades de cada produto.' },
      ]),
    );
    const zero = await refusal(CreatePosOrderDto, { branchId: PRODUCT, paymentMethod: 'PIX', items: [{ productId: PRODUCT, quantity: 0 }] });
    expect(zero.message).toBe('Quantidade do item 1: o mínimo é 1.');
    const empty = await refusal(CreatePosOrderDto, { branchId: PRODUCT, paymentMethod: 'PIX', items: [] });
    expect(empty.message).toBe('Itens: adicione pelo menos 1 item.');
  });

  it('a field the route does not accept (smuggled price) is refused without naming internals', async () => {
    const res = await refusal(CreatePosOrderDto, {
      branchId: PRODUCT,
      paymentMethod: 'PIX',
      items: [{ productId: PRODUCT, quantity: 1, priceCents: 1 }],
    });
    expect(res.message).toBe('A requisição tem um campo que não é aceito aqui.');
  });

  it('labels: nested, indexed and unknown fields', () => {
    expect(fieldLabel('customer.phone')).toBe('telefone do cliente');
    expect(fieldLabel('address.number')).toBe('número do endereço');
    expect(fieldLabel('items.0.quantity')).toBe('quantidade do item 1');
    expect(fieldLabel('somethingInternal')).toBeNull();
  });
});

describe('friendlyMessage (B8, global filter)', () => {
  it('keeps the messages the app writes', () => {
    expect(friendlyMessage(409, 'Não há caixa aberto.')).toBe('Não há caixa aberto.');
  });

  it('replaces what Nest and Express say by themselves', () => {
    expect(friendlyMessage(404, 'Cannot GET /v1/nada')).toBe('Não encontrado.');
    expect(friendlyMessage(429, 'ThrottlerException: Too Many Requests')).toMatch(/^Muitas tentativas/);
    expect(friendlyMessage(400, 'Unexpected token } in JSON at position 10')).toMatch(/^Os dados enviados/);
    expect(friendlyMessage(403, 'Forbidden resource')).toBe('Você não tem permissão para fazer isso.');
    expect(friendlyMessage(401, 'Unauthorized')).toMatch(/^Sua sessão/);
    expect(friendlyMessage(400, 'Validation failed (uuid is expected)')).toMatch(/^Os dados enviados/);
    expect(friendlyMessage(500, undefined)).toBe('Ocorreu um erro inesperado. Tente novamente mais tarde.');
  });

  it('an array of messages becomes one string', () => {
    expect(friendlyMessage(400, ['Primeiro problema.', 'Segundo problema.'])).toBe('Primeiro problema. Segundo problema.');
  });
});
