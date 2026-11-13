import { createHash } from 'crypto';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { AssistantProviderRegistry } from '../src/modules/whatsapp/assistant/assistant-engine.service';
import { AssistantProviderError } from '../src/modules/whatsapp/assistant/assistant-provider';
import { LocalAssistant } from '../src/modules/whatsapp/assistant/local-assistant';
import { WhatsappQueueService } from '../src/modules/whatsapp/queue/whatsapp-queue.service';
import { WhatsappWorkerService } from '../src/modules/whatsapp/queue/whatsapp-worker.service';
import {
  WhatsappReplyService,
  FAILURE_TEXT,
  HANDOFF_TEXT,
  LIMIT_TEXT,
  OPT_OUT_TEXT,
} from '../src/modules/whatsapp/whatsapp-reply.service';
import { buildInboundPayload } from '../src/modules/whatsapp/webhook/whatsapp-payload';
import { signPayload } from '../src/modules/whatsapp/webhook/whatsapp-signature';
import {
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';

// The WhatsApp assistant end to end, on a disposable database, with FICTITIOUS restaurants,
// customers and Meta credentials. No message leaves the test: connections are SIMULATED (or CLOUD
// with sending disabled), and the queue worker does not run by itself (NODE_ENV=test): each test
// drains it explicitly.

const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? '';
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN ?? '';

interface Restaurant {
  token: string;
  tenantId: string;
  slug: string;
  phoneNumberId: string;
  products: Record<string, string>;
  options: Record<string, string>;
}

async function seedBurger(prisma: PrismaService, tenantId: string) {
  const burgers = await prisma.category.create({ data: { tenantId, name: 'Burgers' } });
  const drinks = await prisma.category.create({ data: { tenantId, name: 'Bebidas' } });
  const smash = await prisma.product.create({
    data: { tenantId, categoryId: burgers.id, name: 'Smash Clássico', priceCents: 2600 },
  });
  const juice = await prisma.product.create({
    data: { tenantId, categoryId: drinks.id, name: 'Suco de Laranja', priceCents: 950 },
  });
  const ponto = await prisma.optionGroup.create({
    data: { tenantId, name: 'Ponto da carne', minSelect: 1, maxSelect: 1 },
  });
  const turbine = await prisma.optionGroup.create({
    data: { tenantId, name: 'Turbine', minSelect: 0, maxSelect: 4 },
  });
  const aoPonto = await prisma.optionItem.create({
    data: { tenantId, groupId: ponto.id, name: 'Ao ponto', displayOrder: 1 },
  });
  await prisma.optionItem.create({
    data: { tenantId, groupId: ponto.id, name: 'Bem passado', displayOrder: 2 },
  });
  const bacon = await prisma.optionItem.create({
    data: { tenantId, groupId: turbine.id, name: 'Bacon extra', priceCents: 500, maxQuantity: 2 },
  });
  await prisma.productOptionGroup.createMany({
    data: [
      { tenantId, productId: smash.id, groupId: ponto.id, displayOrder: 0 },
      { tenantId, productId: smash.id, groupId: turbine.id, displayOrder: 1 },
    ],
  });
  return {
    products: { smash: smash.id, juice: juice.id },
    options: { aoPonto: aoPonto.id, bacon: bacon.id },
  };
}

async function seedPizza(prisma: PrismaService, tenantId: string) {
  const pizzas = await prisma.category.create({ data: { tenantId, name: 'Pizzas' } });
  const margherita = await prisma.product.create({
    data: { tenantId, categoryId: pizzas.id, name: 'Pizza Margherita', priceCents: 4500 },
  });
  return { products: { margherita: margherita.id }, options: {} };
}

async function setupRestaurant(
  app: INestApplication,
  kind: 'burger' | 'pizza',
  enable = true,
): Promise<Restaurant> {
  const server = app.getHttpServer();
  const prisma = getPrisma(app);
  const owner = await registerTenantE2E(server);
  const seeded =
    kind === 'burger'
      ? await seedBurger(prisma, owner.tenantId)
      : await seedPizza(prisma, owner.tenantId);
  await request(server)
    .post('/v1/whatsapp/connection/simulated')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .expect(200);
  if (enable) {
    await request(server)
      .put('/v1/whatsapp/settings')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        assistantEnabled: true,
        greetingMessage:
          kind === 'burger' ? 'Bem-vindo ao Burger Teste!' : 'Bem-vindo à Pizzaria Teste!',
      })
      .expect(200);
  }
  const connection = await prisma.whatsappConnection.findUniqueOrThrow({
    where: { tenantId: owner.tenantId },
  });
  return {
    token: owner.accessToken,
    tenantId: owner.tenantId,
    slug: owner.slug,
    phoneNumberId: connection.phoneNumberId,
    ...seeded,
  };
}

let waCounter = 0;
const newWaId = () =>
  `55119${String(Date.now()).slice(-5)}${String((waCounter += 1)).padStart(3, '0')}`.slice(0, 13);

function inbound(
  phoneNumberId: string,
  waId: string,
  body: string,
  at = new Date(),
  id = `wamid.e2e.${uniqueSuffix()}`,
) {
  return buildInboundPayload({
    phoneNumberId,
    displayPhoneNumber: '+55 00 90000-0000',
    waId,
    profileName: 'Cliente Teste',
    providerMessageId: id,
    body,
    timestamp: at,
  });
}

function deliver(app: INestApplication, payload: unknown, secret = APP_SECRET) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return request(app.getHttpServer())
    .post('/v1/whatsapp/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Hub-Signature-256', signPayload(raw, secret))
    .send(raw);
}

async function conversationOf(prisma: PrismaService, tenantId: string, waId: string) {
  const contact = await prisma.whatsappContact.findFirstOrThrow({
    where: { tenantId, waId },
    include: { conversation: true },
  });
  return contact.conversation!;
}

async function outbound(prisma: PrismaService, conversationId: string) {
  return prisma.whatsappMessage.findMany({
    where: { conversationId, direction: 'OUTBOUND' },
    orderBy: { createdAt: 'asc' },
  });
}

beforeAll(() => {
  if (APP_SECRET.length < 16 || VERIFY_TOKEN.length < 16) {
    throw new Error(
      'WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN (fictitious, 16+ chars) must be set for this suite',
    );
  }
});

describe('WhatsApp webhook (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: WhatsappWorkerService;
  let burger: Restaurant;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    worker = app.get(WhatsappWorkerService);
    burger = await setupRestaurant(app, 'burger');
  });
  afterAll(async () => app.close());

  it('answers the subscription handshake only for the verify token', async () => {
    const server = app.getHttpServer();
    const ok = await request(server)
      .get('/v1/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '424242',
      })
      .expect(200);
    expect(ok.text).toBe('424242');
    await request(server)
      .get('/v1/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'not-the-verify-token',
        'hub.challenge': '424242',
      })
      .expect(403);
  });

  it('refuses a delivery without a valid signature and stores nothing', async () => {
    const waId = newWaId();
    const payload = inbound(burger.phoneNumberId, waId, 'oi');
    await request(app.getHttpServer()).post('/v1/whatsapp/webhook').send(payload).expect(401);
    await deliver(app, payload, 'a-different-secret-0123456789').expect(401);
    // Signed over other bytes than the ones sent.
    await request(app.getHttpServer())
      .post('/v1/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signPayload(JSON.stringify(payload), APP_SECRET))
      .send(JSON.stringify(payload, null, 2))
      .expect(401);
    expect(await prisma.whatsappContact.count({ where: { waId } })).toBe(0);
  });

  it('a number that belongs to no restaurant is accepted (200) and ignored', async () => {
    const waId = newWaId();
    const res = await deliver(app, inbound('phone-number-of-nobody', waId, 'oi')).expect(200);
    expect(res.body).toMatchObject({ received: true, stored: 0 });
    expect(await prisma.whatsappContact.count({ where: { waId } })).toBe(0);
  });

  it('a delivery repeated (same bytes, other bytes, at the same time) stores the message once and is answered once', async () => {
    const waId = newWaId();
    const payload = inbound(burger.phoneNumberId, waId, 'oi');
    const raw = JSON.stringify(payload);
    await deliver(app, raw).expect(200);
    await deliver(app, raw).expect(200);
    // The same wamid inside another delivery (other key order -> other bytes).
    const reordered = {
      entry: (payload as { entry: unknown }).entry,
      object: 'whatsapp_business_account',
    };
    const again = await deliver(app, reordered).expect(200);
    expect(again.body).toMatchObject({ stored: 0, duplicates: 1 });
    // Three deliveries at the same moment.
    const concurrent = inbound(burger.phoneNumberId, waId, 'cardápio');
    await Promise.all([
      deliver(app, concurrent),
      deliver(app, { ...concurrent }),
      deliver(app, JSON.stringify(concurrent)),
    ]);

    await worker.drain();
    const conversation = await conversationOf(prisma, burger.tenantId, waId);
    const inboundCount = await prisma.whatsappMessage.count({
      where: { conversationId: conversation.id, direction: 'INBOUND' },
    });
    expect(inboundCount).toBe(2);
    const replies = await outbound(prisma, conversation.id);
    // Both messages arrived before the queue ran: ONE reply answers both.
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ author: 'ASSISTANT', status: 'DELIVERED' });
    expect(replies[0].body).toContain('Bem-vindo ao Burger Teste!');
    const event = await prisma.whatsappWebhookEvent.findFirstOrThrow({
      where: { payloadHash: createHash('sha256').update(raw).digest('hex') },
    });
    expect(event.duplicates).toBe(1);
  });

  it('messages delivered out of order land in their place, and statuses never go back', async () => {
    const waId = newWaId();
    const t0 = new Date(Date.now() - 60_000);
    await deliver(
      app,
      inbound(burger.phoneNumberId, waId, 'segunda mensagem', new Date(t0.getTime() + 30_000)),
    ).expect(200);
    await deliver(app, inbound(burger.phoneNumberId, waId, 'primeira mensagem', t0)).expect(200);
    await worker.drain();

    const conversation = await conversationOf(prisma, burger.tenantId, waId);
    const thread = await request(app.getHttpServer())
      .get(`/v1/whatsapp/conversations/${conversation.id}`)
      .set('Authorization', `Bearer ${burger.token}`)
      .expect(200);
    const bodies = thread.body.messages.map((m: { body: string }) => m.body);
    expect(bodies.slice(0, 2)).toEqual(['primeira mensagem', 'segunda mensagem']);
    expect(
      thread.body.messages.filter((m: { direction: string }) => m.direction === 'OUTBOUND'),
    ).toHaveLength(1);

    // READ arrives before DELIVERED, then a late FAILED: the message stays READ.
    const [reply] = await outbound(prisma, conversation.id);
    const status = (s: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'w',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: 'x', phone_number_id: burger.phoneNumberId },
                statuses: [
                  {
                    id: reply.providerMessageId,
                    status: s,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await deliver(app, status('read')).expect(200);
    await deliver(app, status('delivered')).expect(200);
    await deliver(app, status('failed')).expect(200);
    expect(
      (await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: reply.id } })).status,
    ).toBe('READ');
  });

  it('with the assistant switched off, messages wait for the team (no reply, unread counted)', async () => {
    const quiet = await setupRestaurant(app, 'pizza', false);
    const waId = newWaId();
    await deliver(app, inbound(quiet.phoneNumberId, waId, 'oi')).expect(200);
    await worker.drain();
    const conversation = await conversationOf(prisma, quiet.tenantId, waId);
    expect(await outbound(prisma, conversation.id)).toHaveLength(0);
    expect(conversation.unreadCount).toBe(1);
  });

  it('a CLOUD connection never sends while Cloud sending is disabled', async () => {
    const owner = await registerTenantE2E(app.getHttpServer());
    const phoneNumberId = `cloud-${uniqueSuffix()}`;
    await prisma.whatsappConnection.create({
      data: {
        tenantId: owner.tenantId,
        mode: 'CLOUD',
        phoneNumberId,
        displayPhoneNumber: '+55 11 0000-0000',
        assistantEnabled: true,
        accessTokenEncrypted: null,
      },
    });
    const waId = newWaId();
    await deliver(app, inbound(phoneNumberId, waId, 'oi')).expect(200);
    await worker.drain();
    const conversation = await conversationOf(prisma, owner.tenantId, waId);
    const [reply] = await outbound(prisma, conversation.id);
    expect(reply).toMatchObject({
      status: 'FAILED',
      errorCode: 'CLOUD_DISABLED',
      providerMessageId: null,
    });
  });
});

describe('WhatsApp assistant: orders, links, hand-off and failures (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: WhatsappWorkerService;
  let burger: Restaurant;

  const simulate = async (r: Restaurant, phone: string, text: string) => {
    const res = await request(app.getHttpServer())
      .post('/v1/whatsapp/simulator/messages')
      .set('Authorization', `Bearer ${r.token}`)
      .send({ contactName: 'Cliente Teste', contactPhone: phone, text })
      .expect(200);
    await worker.drain();
    const replies = await outbound(prisma, res.body.conversationId);
    return {
      conversationId: res.body.conversationId as string,
      waId: res.body.waId as string,
      last: replies[replies.length - 1],
      count: replies.length,
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    worker = app.get(WhatsappWorkerService);
    burger = await setupRestaurant(app, 'burger');
  });
  afterAll(async () => app.close());

  it('takes an order with add-ons, validates the required group, summarizes, and links to the checkout only after "sim"', async () => {
    const phone = '91000-0001';
    const ordersBefore = await prisma.order.count({ where: { tenantId: burger.tenantId } });

    expect((await simulate(burger, phone, 'oi')).last.body).toContain('Bem-vindo ao Burger Teste!');
    const ask = await simulate(burger, phone, 'quero 2 smash com bacon extra sem cebola');
    expect(ask.last.body).toContain('Ponto da carne');
    const added = await simulate(burger, phone, 'ao ponto');
    expect(added.last.body).toContain('2× Smash Clássico — R$ 62,00');
    expect(added.last.body).toContain('Obs.: sem cebola');
    const summary = await simulate(burger, phone, 'fechar');
    expect(summary.last.body).toContain('*Resumo do pedido*');
    expect(summary.last.body).toContain('Subtotal: R$ 62,00');
    const confirmed = await simulate(burger, phone, 'sim');
    const url = confirmed.last.body.match(/https?:\/\/\S+\/menu\/[\w-]+\/whatsapp\/([\w-]{43})/);
    expect(url).not.toBeNull();
    const token = url![1];

    // Nothing was ordered: the order only exists after the customer confirms in the checkout.
    expect(await prisma.order.count({ where: { tenantId: burger.tenantId } })).toBe(ordersBefore);
    expect(
      await prisma.whatsappCheckoutLink.count({
        where: { conversationId: confirmed.conversationId },
      }),
    ).toBe(1);
    const stored = await prisma.whatsappCheckoutLink.findFirstOrThrow({
      where: { conversationId: confirmed.conversationId },
    });
    expect(stored.tokenHash).not.toContain(token);

    const server = app.getHttpServer();
    const cart = await request(server)
      .get(`/v1/public/whatsapp-carts/${burger.slug}/${token}`)
      .expect(200);
    expect(cart.body).toMatchObject({
      restaurant: { slug: burger.slug },
      subtotalCents: 6200,
      items: [
        {
          productId: burger.products.smash,
          quantity: 2,
          unitPriceCents: 3100,
          notes: 'sem cebola',
          available: true,
          options: expect.arrayContaining([
            expect.objectContaining({ optionId: burger.options.aoPonto, priceCents: 0 }),
            expect.objectContaining({
              optionId: burger.options.bacon,
              priceCents: 500,
              quantity: 1,
            }),
          ]),
        },
      ],
    });
    expect(JSON.stringify(cart.body)).not.toContain(confirmed.waId);

    // The photo of each line is the one the public menu shows (correcao-fotos-produtos): none yet,
    // then an imported photo (media_assets) becomes its public URL. Nothing is copied.
    expect(cart.body.items[0].imageUrl).toBeNull();
    const photo = await prisma.mediaAsset.create({
      data: {
        tenantId: burger.tenantId,
        contentType: 'image/png',
        sizeBytes: 4,
        sha256: createHash('sha256').update(`e2e-whatsapp-cart-photo-${Date.now()}`).digest('hex'),
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
    });
    await prisma.product.update({
      where: { id: burger.products.smash },
      data: { imageMediaId: photo.id },
    });
    const withPhoto = await request(server)
      .get(`/v1/public/whatsapp-carts/${burger.slug}/${token}`)
      .expect(200);
    expect(withPhoto.body.items[0].imageUrl).toBe(`/api/public/media/${photo.id}`);
    expect(withPhoto.body.subtotalCents).toBe(6200);
    await prisma.product.update({
      where: { id: burger.products.smash },
      data: { imageMediaId: null },
    });
    await prisma.mediaAsset.delete({ where: { id: photo.id } });

    // Priced again when opened: a new price shows; a sold-out product is flagged, not charged.
    await prisma.product.update({
      where: { id: burger.products.smash },
      data: { priceCents: 2800 },
    });
    expect(
      (await request(server).get(`/v1/public/whatsapp-carts/${burger.slug}/${token}`).expect(200))
        .body.subtotalCents,
    ).toBe(6600);
    await prisma.product.update({ where: { id: burger.products.smash }, data: { soldOut: true } });
    const soldOut = await request(server)
      .get(`/v1/public/whatsapp-carts/${burger.slug}/${token}`)
      .expect(200);
    expect(soldOut.body).toMatchObject({ subtotalCents: 0, items: [{ available: false }] });
    await prisma.product.update({
      where: { id: burger.products.smash },
      data: { soldOut: false, priceCents: 2600 },
    });

    // Another restaurant's slug, a made-up token, an expired link.
    const other = await setupRestaurant(app, 'pizza');
    await request(server).get(`/v1/public/whatsapp-carts/${other.slug}/${token}`).expect(404);
    await request(server)
      .get(`/v1/public/whatsapp-carts/${burger.slug}/${'x'.repeat(43)}`)
      .expect(404);
    await request(server).get(`/v1/public/whatsapp-carts/${burger.slug}/short`).expect(404);
    await prisma.whatsappCheckoutLink.update({
      where: { id: stored.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await request(server).get(`/v1/public/whatsapp-carts/${burger.slug}/${token}`).expect(410);

    const audit = await prisma.auditLog.count({
      where: { tenantId: burger.tenantId, action: 'whatsapp.checkout_link.create' },
    });
    expect(audit).toBe(1);
  });

  it("a sold-out add-on never enters the cart; the price is the server's", async () => {
    await prisma.optionItem.update({
      where: { id: burger.options.bacon },
      data: { soldOut: true },
    });
    try {
      const r = await simulate(burger, '91000-0002', 'quero 1 smash ao ponto com bacon extra');
      expect(r.last.body).toContain('1× Smash Clássico — R$ 26,00');
      expect(r.last.body).not.toContain('Bacon extra');
    } finally {
      await prisma.optionItem.update({
        where: { id: burger.options.bacon },
        data: { soldOut: false },
      });
    }
  });

  it('"atendente" hands the conversation to a person; the team takes over, answers and gives it back', async () => {
    const server = app.getHttpServer();
    const phone = '91000-0003';
    const handoff = await simulate(burger, phone, 'quero falar com um atendente');
    expect(handoff.last.body).toBe(HANDOFF_TEXT);
    expect(
      (
        await prisma.whatsappConversation.findUniqueOrThrow({
          where: { id: handoff.conversationId },
        })
      ).status,
    ).toBe('HUMAN');
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: burger.tenantId,
          action: 'whatsapp.handoff',
          entityId: handoff.conversationId,
        },
      }),
    ).toBe(1);

    // While a person has it, the assistant stays quiet.
    const quiet = await simulate(burger, phone, 'oi? alguém?');
    expect(quiet.count).toBe(handoff.count);

    const auth = { Authorization: `Bearer ${burger.token}` };
    const assumed = await request(server)
      .post(`/v1/whatsapp/conversations/${handoff.conversationId}/assume`)
      .set(auth)
      .expect(200);
    expect(assumed.body).toMatchObject({
      status: 'HUMAN',
      assignedUser: { id: expect.any(String) },
    });
    await request(server)
      .post(`/v1/whatsapp/conversations/${handoff.conversationId}/messages`)
      .set(auth)
      .send({ text: 'Oi! Aqui é a Maria, como posso ajudar?' })
      .expect(201);
    await worker.drain();
    const agent = (await outbound(prisma, handoff.conversationId)).pop()!;
    expect(agent).toMatchObject({
      author: 'AGENT',
      status: 'DELIVERED',
      body: 'Oi! Aqui é a Maria, como posso ajudar?',
    });

    const released = await request(server)
      .post(`/v1/whatsapp/conversations/${handoff.conversationId}/release`)
      .set(auth)
      .expect(200);
    expect(released.body).toMatchObject({ status: 'AI', assignedUser: null });
    const back = await simulate(burger, phone, 'cardápio');
    expect(back.last).toMatchObject({ author: 'ASSISTANT' });
    expect(back.last.body).toContain('Burgers');
    expect(
      await prisma.auditLog.count({
        where: {
          tenantId: burger.tenantId,
          entityId: handoff.conversationId,
          action: {
            in: [
              'whatsapp.conversation.assume',
              'whatsapp.message.agent_reply',
              'whatsapp.conversation.release',
            ],
          },
        },
      }),
    ).toBe(3);
  });

  it('a failing AI provider falls back to the local assistant; when that fails too, a person takes over', async () => {
    const registry = app.get(AssistantProviderRegistry);
    registry.register({
      name: 'falha',
      reply: async () => {
        throw new AssistantProviderError('provider down (test)', true);
      },
    });
    registry.setActive('falha');
    try {
      const r = await simulate(burger, '91000-0004', 'cardápio');
      expect(r.last).toMatchObject({ author: 'ASSISTANT', aiProvider: 'local' });
      expect(r.last.body).toContain('Burgers');
      expect(
        await prisma.auditLog.count({
          where: {
            tenantId: burger.tenantId,
            action: 'whatsapp.assistant.guard',
            entityId: r.last.id,
          },
        }),
      ).toBe(1);

      // The local assistant breaks as well: the job is retried, and on its last attempt the
      // customer is told and a person takes over (never silence, never a duplicate).
      registry.register({
        name: 'local',
        reply: async () => {
          throw new Error('local broken (test)');
        },
      });
      const res = await request(app.getHttpServer())
        .post('/v1/whatsapp/simulator/messages')
        .set('Authorization', `Bearer ${burger.token}`)
        .send({ contactName: 'Cliente Teste', contactPhone: '91000-0005', text: 'oi' })
        .expect(200);
      await worker.drain();
      const job = await prisma.whatsappJob.findFirstOrThrow({
        where: { conversationId: res.body.conversationId, type: 'REPLY' },
      });
      expect(job).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(job.lastError).toContain('local broken');
      await prisma.whatsappJob.update({
        where: { id: job.id },
        data: { runAt: new Date(), maxAttempts: 2 },
      });
      await worker.drain();
      const replies = await outbound(prisma, res.body.conversationId);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({ author: 'SYSTEM', body: FAILURE_TEXT });
      expect(
        (
          await prisma.whatsappConversation.findUniqueOrThrow({
            where: { id: res.body.conversationId },
          })
        ).status,
      ).toBe('HUMAN');
    } finally {
      registry.register(new LocalAssistant());
      registry.setActive('local');
    }
  });

  it('the same messages are never answered twice: concurrent runs and a re-run job', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/whatsapp/simulator/messages')
      .set('Authorization', `Bearer ${burger.token}`)
      .send({ contactName: 'Cliente Teste', contactPhone: '91000-0006', text: 'qual o horário?' })
      .expect(200);
    const queue = app.get(WhatsappQueueService);
    const reply = app.get(WhatsappReplyService);
    const job = await queue.claimNext();
    expect(job).toMatchObject({ type: 'REPLY', conversationId: res.body.conversationId });
    const outcomes = await Promise.all([
      reply.process(job!),
      reply.process(job!),
      reply.process(job!),
    ]);
    expect(outcomes.filter((o) => o === 'done').length).toBeGreaterThanOrEqual(1);
    await queue.complete(job!.id);
    // The job runs again (e.g. a worker that died before marking it done).
    await prisma.whatsappJob.update({
      where: { id: job!.id },
      data: { status: 'PENDING', runAt: new Date() },
    });
    await worker.drain();
    const replies = await prisma.whatsappMessage.count({
      where: { conversationId: res.body.conversationId, author: 'ASSISTANT' },
    });
    expect(replies).toBe(1);
  });

  it('cost control: the daily limit hands over to the team; "parar" opts out; the 24 h window is enforced', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${burger.token}` };
    await request(server)
      .put('/v1/whatsapp/settings')
      .set(auth)
      .send({ aiDailyReplyLimit: 0 })
      .expect(200);
    try {
      const limited = await simulate(burger, '91000-0007', 'cardápio');
      expect(limited.last).toMatchObject({ author: 'SYSTEM', body: LIMIT_TEXT });
      expect(
        (
          await prisma.whatsappConversation.findUniqueOrThrow({
            where: { id: limited.conversationId },
          })
        ).status,
      ).toBe('HUMAN');
    } finally {
      await request(server)
        .put('/v1/whatsapp/settings')
        .set(auth)
        .send({ aiDailyReplyLimit: 300 })
        .expect(200);
    }

    const stop = await simulate(burger, '91000-0008', 'parar');
    expect(stop.last).toMatchObject({ body: OPT_OUT_TEXT, status: 'DELIVERED' });
    const res = await request(server)
      .post(`/v1/whatsapp/conversations/${stop.conversationId}/messages`)
      .set(auth)
      .send({ text: 'Promoção!' })
      .expect(409);
    expect(res.body.code).toBe('OPTED_OUT');

    const late = await simulate(burger, '91000-0009', 'oi');
    const conversation = await prisma.whatsappConversation.findUniqueOrThrow({
      where: { id: late.conversationId },
    });
    await prisma.whatsappContact.update({
      where: { id: conversation.contactId },
      data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    const closed = await request(server)
      .post(`/v1/whatsapp/conversations/${late.conversationId}/messages`)
      .set(auth)
      .send({ text: 'Oi!' })
      .expect(409);
    expect(closed.body.code).toBe('WINDOW_CLOSED');
  });
});

describe('WhatsApp isolation, permissions and validation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let worker: WhatsappWorkerService;
  let burger: Restaurant;
  let pizza: Restaurant;
  let burgerConversation: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = getPrisma(app);
    worker = app.get(WhatsappWorkerService);
    burger = await setupRestaurant(app, 'burger');
    pizza = await setupRestaurant(app, 'pizza');
    const res = await request(app.getHttpServer())
      .post('/v1/whatsapp/simulator/messages')
      .set('Authorization', `Bearer ${burger.token}`)
      .send({
        contactName: 'Cliente Burger',
        contactPhone: '92000-0001',
        text: 'quero 1 suco de laranja',
      })
      .expect(200);
    burgerConversation = res.body.conversationId;
    await worker.drain();
  });
  afterAll(async () => app.close());

  it("a restaurant never sees nor touches another restaurant's conversations", async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${pizza.token}` };
    const list = await request(server).get('/v1/whatsapp/conversations').set(auth).expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).not.toContain(burgerConversation);
    await request(server)
      .get(`/v1/whatsapp/conversations/${burgerConversation}`)
      .set(auth)
      .expect(404);
    await request(server)
      .post(`/v1/whatsapp/conversations/${burgerConversation}/messages`)
      .set(auth)
      .send({ text: 'oi' })
      .expect(404);
    await request(server)
      .post(`/v1/whatsapp/conversations/${burgerConversation}/assume`)
      .set(auth)
      .expect(404);
    await request(server)
      .post(`/v1/whatsapp/conversations/${burgerConversation}/release`)
      .set(auth)
      .expect(404);
    await request(server)
      .post(`/v1/whatsapp/conversations/${burgerConversation}/read`)
      .set(auth)
      .expect(404);
  });

  it("each assistant knows only its own restaurant's menu, even when asked about the other's", async () => {
    const server = app.getHttpServer();
    const ask = async (r: Restaurant, phone: string, text: string) => {
      const res = await request(server)
        .post('/v1/whatsapp/simulator/messages')
        .set('Authorization', `Bearer ${r.token}`)
        .send({ contactName: 'C', contactPhone: phone, text })
        .expect(200);
      await worker.drain();
      return (await outbound(prisma, res.body.conversationId)).pop()!.body;
    };
    const pizzaMenu = await ask(pizza, '92000-0002', 'cardápio');
    expect(pizzaMenu).toContain('Pizzas');
    expect(pizzaMenu).not.toContain('Burgers');
    const crossed = await ask(pizza, '92000-0002', 'quero 1 smash clássico com bacon extra');
    expect(crossed).not.toContain('Smash');
    expect(crossed).not.toContain('R$ 26,00');
    const pizzaConversation = await prisma.whatsappConversation.findFirstOrThrow({
      where: { tenantId: pizza.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    expect(pizzaConversation.cart ?? []).toEqual([]);
    // The burger customer's cart holds the burger product.
    const burgerCart = (
      await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: burgerConversation } })
    ).cart as { productId: string }[];
    expect(burgerCart.map((l) => l.productId)).toEqual([burger.products.juice]);
  });

  it('permissions: the counter reads and answers, only management configures, the kitchen sees nothing', async () => {
    const server = app.getHttpServer();
    const cashier = await createStaffAndLoginE2E(app, server, burger.tenantId, 'CASHIER');
    const manager = await createStaffAndLoginE2E(app, server, burger.tenantId, 'MANAGER');
    const waiter = await createStaffAndLoginE2E(app, server, burger.tenantId, 'WAITER');
    const kitchen = await createStaffAndLoginE2E(app, server, burger.tenantId, 'KITCHEN');
    const as = (token: string) => ({ Authorization: `Bearer ${token}` });

    await request(server).get('/v1/whatsapp/conversations').set(as(cashier)).expect(200);
    await request(server)
      .post(`/v1/whatsapp/conversations/${burgerConversation}/messages`)
      .set(as(cashier))
      .send({ text: 'Já sai!' })
      .expect(201);
    await request(server)
      .put('/v1/whatsapp/settings')
      .set(as(cashier))
      .send({ assistantEnabled: false })
      .expect(403);
    await request(server)
      .post('/v1/whatsapp/simulator/messages')
      .set(as(cashier))
      .send({ contactName: 'x', contactPhone: '1234', text: 'oi' })
      .expect(403);
    await request(server).get('/v1/whatsapp/settings').set(as(manager)).expect(200);
    await request(server)
      .put('/v1/whatsapp/settings')
      .set(as(manager))
      .send({ assistantEnabled: false })
      .expect(403);
    await request(server).get('/v1/whatsapp/conversations').set(as(waiter)).expect(403);
    await request(server).get('/v1/whatsapp/settings').set(as(kitchen)).expect(403);
    await request(server).get('/v1/whatsapp/conversations').expect(401);
  });

  it('validation: empty or long replies, out-of-range limits and unknown fields are refused', async () => {
    const server = app.getHttpServer();
    const auth = { Authorization: `Bearer ${burger.token}` };
    await request(server)
      .post(`/v1/whatsapp/conversations/${burgerConversation}/messages`)
      .set(auth)
      .send({ text: '   ' })
      .expect(400);
    await request(server)
      .post(`/v1/whatsapp/conversations/${burgerConversation}/messages`)
      .set(auth)
      .send({ text: 'x'.repeat(1001) })
      .expect(400);
    await request(server)
      .put('/v1/whatsapp/settings')
      .set(auth)
      .send({ aiDailyReplyLimit: 99_999 })
      .expect(400);
    await request(server)
      .put('/v1/whatsapp/settings')
      .set(auth)
      .send({ provider: 'gpt' })
      .expect(400);
    await request(server).get('/v1/whatsapp/conversations/not-a-uuid').set(auth).expect(400);
    await request(server).get('/v1/whatsapp/conversations?status=SOMETHING').set(auth).expect(400);
    const settings = await request(server).get('/v1/whatsapp/settings').set(auth).expect(200);
    expect(settings.body).toMatchObject({
      connection: { mode: 'SIMULATED' },
      ai: { provider: 'local' },
      cloudSendingEnabled: false,
    });
    expect(JSON.stringify(settings.body)).not.toMatch(/accessToken|secret/i);
  });
});
