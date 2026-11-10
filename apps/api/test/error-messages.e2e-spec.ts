import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, registerTenantE2E } from './test-app.util';

// B8 (piloto 2026-10-23): "customer.name must be longer than or equal to 2 characters" reached a
// guest at the checkout. Every refusal is one Portuguese sentence, with the API's code kept.
const ENGLISH = /must|should|longer than|shorter than|greater than|less than|property|Bad Request|Cannot (GET|POST)|Unauthorized|Forbidden resource|JSON/;

describe('Error messages in Portuguese (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });

  const expectPortuguese = (body: { code: string; message: unknown }, code: string) => {
    expect(body.code).toBe(code);
    expect(typeof body.message).toBe('string');
    expect(body.message).not.toMatch(ENGLISH);
  };

  it('checkout: name, phone, address and payment come back in Portuguese, naming the field', async () => {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, 'Água', 4);
    const order = (body: Record<string, unknown>) =>
      request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: tenant.slug,
          items: [{ productId: product.id, quantity: 1 }],
          customer: { name: 'Ana Cliente', phone: '11987654321' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
          ...body,
        });

    const name = await order({ customer: { name: 'A', phone: '11987654321' } }).expect(400);
    expectPortuguese(name.body, 'VALIDATION_ERROR');
    expect(name.body.message).toBe('Nome do cliente: use pelo menos 2 caracteres.');
    expect(name.body.details).toEqual([{ field: 'customer.name', message: 'Nome do cliente: use pelo menos 2 caracteres.' }]);

    const phone = await order({ customer: { name: 'Ana Cliente', phone: 'abc' } }).expect(400);
    expect(phone.body.message).toBe('Telefone em formato inválido.');

    const address = await order({ fulfillmentType: 'DELIVERY', address: { street: 'Rua A', number: '1', city: 'São Paulo', state: 'SP', zipCode: '01001-000' } }).expect(400);
    expectPortuguese(address.body, 'VALIDATION_ERROR');
    expect(address.body.message).toBe('Bairro do endereço: campo obrigatório.');

    const payment = await order({ paymentMethod: 'ON_ACCOUNT' }).expect(400);
    expect(payment.body.message).toBe('Forma de pagamento: opção inválida.');

    const quantity = await order({ items: [{ productId: product.id, quantity: 51 }] }).expect(400);
    expect(quantity.body.message).toBe('No máximo 50 unidades de cada produto.');

    const empty = await order({ items: [] }).expect(400);
    expect(empty.body.message).toBe('Itens: adicione pelo menos 1 item.');

    // A business refusal keeps its own code and message.
    await request(server)
      .patch(`/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ active: false })
      .expect(200);
    const unavailable = await order({}).expect(400);
    expectPortuguese(unavailable.body, 'PRODUCT_UNAVAILABLE');
  });

  it('PDV, cash and stock: invalid fields in Portuguese', async () => {
    const tenant = await registerTenantE2E(server);
    const auth = { Authorization: `Bearer ${tenant.accessToken}` };

    const pos = await request(server)
      .post('/v1/pos/orders')
      .set(auth)
      .send({ branchId: tenant.branchId, paymentMethod: 'PIX', items: [{ productId: 'nao-e-um-id', quantity: 0 }] })
      .expect(400);
    expectPortuguese(pos.body, 'VALIDATION_ERROR');
    expect(pos.body.details.map((d: { message: string }) => d.message)).toEqual(
      expect.arrayContaining(['Produto do item 1: item não encontrado.', 'Quantidade do item 1: o mínimo é 1.']),
    );

    const session = (
      await request(server).post('/v1/cash/sessions').set(auth).send({ branchId: tenant.branchId, openingBalanceCents: 1000 }).expect(201)
    ).body;
    const cash = await request(server)
      .post(`/v1/cash/sessions/${session.id}/movements`)
      .set(auth)
      .send({ type: 'SUPPLY', amountCents: 0 })
      .expect(400);
    expectPortuguese(cash.body, 'VALIDATION_ERROR');
    expect(cash.body.message).toBe('Valor: o mínimo é 1.');

    const stock = await request(server)
      .post('/v1/inventory/movements')
      .set(auth)
      .send({ branchId: tenant.branchId, type: 'ENTRY', quantity: 1 })
      .expect(400);
    expectPortuguese(stock.body, 'VALIDATION_ERROR');

    const smuggled = await request(server)
      .post('/v1/pos/orders')
      .set(auth)
      .send({ branchId: tenant.branchId, paymentMethod: 'PIX', items: [], total: 1 })
      .expect(400);
    expect(smuggled.body.message).toContain('A requisição tem um campo que não é aceito aqui.');
  });

  it('what the framework says by itself: unknown route, broken JSON, no login', async () => {
    const route = await request(server).get('/v1/nao-existe').expect(404);
    expectPortuguese(route.body, 'NOT_FOUND');

    const json = await request(server)
      .post('/v1/public/orders')
      .set('Content-Type', 'application/json')
      .send('{"restaurantSlug": ')
      .expect(400);
    expectPortuguese(json.body, 'VALIDATION_ERROR');

    const login = await request(server).get('/v1/orders').expect(401);
    expectPortuguese(login.body, 'UNAUTHORIZED');
  });
});
