// Single source of truth for every fictitious value shown under /demo.
// Nothing here is fetched, persisted, or sent anywhere — it's a plain
// module-level constant. See docs/DEMO_MODE.md.
import { DemoCashMovement, DemoCategory, DemoOrder, DemoProduct, DemoStats } from './types';

export const demoStats: DemoStats = {
  salesTodayCents: 243_850, // R$ 2.438,50
  ordersToday: 87,
  avgTicketCents: 2_803, // R$ 28,03
  inPreparation: 6,
  activeProducts: 32,
};

export const demoCategories: DemoCategory[] = [
  { id: 'hamburgueres', name: 'Hambúrgueres' },
  { id: 'combos', name: 'Combos' },
  { id: 'porcoes', name: 'Porções' },
  { id: 'bebidas', name: 'Bebidas' },
];

// Prices are picked so the two order examples given for /demo/pedidos
// (#1042 = R$ 74,70 e #1041 = R$ 36,90) fall out exactly from
// quantity × unit price below — not a coincidence, kept consistent on
// purpose so the demo never contradicts itself between screens.
export const demoProducts: DemoProduct[] = [
  {
    id: 'x-burger',
    categoryId: 'hamburgueres',
    name: 'X-Burger',
    description: 'Pão brioche, hambúrguer 120g, queijo, alface e tomate.',
    priceCents: 2_990,
    available: true,
    emoji: '🍔',
  },
  {
    id: 'x-bacon',
    categoryId: 'hamburgueres',
    name: 'X-Bacon',
    description: 'Pão brioche, hambúrguer 120g, bacon crocante e queijo.',
    priceCents: 3_000,
    available: true,
    emoji: '🥓',
  },
  {
    id: 'duplo-cheddar',
    categoryId: 'hamburgueres',
    name: 'Duplo Cheddar',
    description: 'Dois hambúrgueres, cheddar cremoso e cebola caramelizada.',
    priceCents: 3_490,
    available: false,
    emoji: '🧀',
  },
  {
    id: 'combo-classico',
    categoryId: 'combos',
    name: 'Combo Clássico',
    description: 'X-Burger + batata frita + refrigerante lata.',
    priceCents: 4_290,
    available: true,
    emoji: '🍱',
  },
  {
    id: 'batata-frita',
    categoryId: 'porcoes',
    name: 'Batata Frita',
    description: 'Porção generosa, crocante, servida na hora.',
    priceCents: 1_490,
    available: true,
    emoji: '🍟',
  },
  {
    id: 'coca-cola',
    categoryId: 'bebidas',
    name: 'Coca-Cola',
    description: 'Lata 350ml, gelada.',
    priceCents: 690,
    available: true,
    emoji: '🥤',
  },
];

function findProduct(id: string) {
  const product = demoProducts.find((p) => p.id === id);
  if (!product) throw new Error(`demo product not found: ${id}`);
  return product;
}

function orderTotal(items: { productId: string; quantity: number }[]) {
  return items.reduce((sum, i) => sum + findProduct(i.productId).priceCents * i.quantity, 0);
}

function buildOrder(input: {
  orderNumber: number;
  status: DemoOrder['status'];
  items: { productId: string; quantity: number }[];
  elapsedMinutes: number;
  customerName?: string;
  notes?: string;
}): DemoOrder {
  const items = input.items.map((i) => {
    const product = findProduct(i.productId);
    return {
      productId: product.id,
      name: product.name,
      quantity: i.quantity,
      unitPriceCents: product.priceCents,
    };
  });
  return {
    orderNumber: input.orderNumber,
    status: input.status,
    items,
    totalCents: orderTotal(input.items),
    elapsedMinutes: input.elapsedMinutes,
    customerName: input.customerName,
    notes: input.notes,
  };
}

// 15 orders, spread so PREPARING has exactly 6 — matching
// `demoStats.inPreparation` shown on the dashboard. Both /demo/pedidos
// (5 columns) and /demo/cozinha (3 columns) render this same list, each
// filtering/grouping it differently — exactly like the real admin panel
// and KDS both read from the same Order table.
export const demoOrders: DemoOrder[] = [
  buildOrder({ orderNumber: 1050, status: 'PENDING', items: [{ productId: 'combo-classico', quantity: 2 }], elapsedMinutes: 1 }),
  buildOrder({ orderNumber: 1051, status: 'PENDING', items: [{ productId: 'duplo-cheddar', quantity: 1 }], elapsedMinutes: 2, notes: 'Sem cebola' }),
  buildOrder({ orderNumber: 1040, status: 'CONFIRMED', items: [{ productId: 'x-burger', quantity: 1 }, { productId: 'coca-cola', quantity: 1 }], elapsedMinutes: 2 }),
  buildOrder({ orderNumber: 1041, status: 'CONFIRMED', items: [{ productId: 'x-bacon', quantity: 1 }, { productId: 'coca-cola', quantity: 1 }], elapsedMinutes: 4 }),
  buildOrder({ orderNumber: 1042, status: 'PREPARING', items: [{ productId: 'x-burger', quantity: 2 }, { productId: 'batata-frita', quantity: 1 }], elapsedMinutes: 9, notes: 'Sem cebola' }),
  buildOrder({ orderNumber: 1043, status: 'PREPARING', items: [{ productId: 'duplo-cheddar', quantity: 1 }, { productId: 'coca-cola', quantity: 1 }], elapsedMinutes: 12 }),
  buildOrder({ orderNumber: 1044, status: 'PREPARING', items: [{ productId: 'combo-classico', quantity: 1 }], elapsedMinutes: 6 }),
  buildOrder({ orderNumber: 1045, status: 'PREPARING', items: [{ productId: 'x-burger', quantity: 3 }], elapsedMinutes: 16, notes: 'Retirada no balcão' }),
  buildOrder({ orderNumber: 1046, status: 'PREPARING', items: [{ productId: 'x-bacon', quantity: 2 }, { productId: 'coca-cola', quantity: 2 }], elapsedMinutes: 5 }),
  buildOrder({ orderNumber: 1047, status: 'PREPARING', items: [{ productId: 'batata-frita', quantity: 1 }, { productId: 'coca-cola', quantity: 2 }], elapsedMinutes: 3 }),
  buildOrder({ orderNumber: 1048, status: 'READY', items: [{ productId: 'x-burger', quantity: 1 }, { productId: 'coca-cola', quantity: 1 }], elapsedMinutes: 18 }),
  buildOrder({ orderNumber: 1049, status: 'READY', items: [{ productId: 'combo-classico', quantity: 1 }, { productId: 'batata-frita', quantity: 1 }], elapsedMinutes: 21 }),
  buildOrder({ orderNumber: 1036, status: 'COMPLETED', items: [{ productId: 'coca-cola', quantity: 2 }, { productId: 'batata-frita', quantity: 1 }], elapsedMinutes: 48 }),
  buildOrder({ orderNumber: 1038, status: 'COMPLETED', items: [{ productId: 'combo-classico', quantity: 1 }], elapsedMinutes: 55 }),
  buildOrder({ orderNumber: 1039, status: 'COMPLETED', items: [{ productId: 'x-burger', quantity: 1 }, { productId: 'batata-frita', quantity: 1 }], elapsedMinutes: 60 }),
];

// Caixa — every number below is hand-picked to satisfy, exactly:
//   esperado = abertura + vendas em dinheiro + suprimentos - sangrias
//   200,00   + 1.280,00                      + 100,00       - 150,00  = 1.430,00
const openingBalanceCents = 20_000;
const cashSalesCents = 128_000;
const suppliesCents = 10_000;
const withdrawalsCents = 15_000;

export const demoCash = {
  status: 'OPEN' as const,
  openingBalanceCents,
  cashSalesCents,
  suppliesCents,
  withdrawalsCents,
  expectedBalanceCents: openingBalanceCents + cashSalesCents + suppliesCents - withdrawalsCents,
  countedBalanceCents: 143_000,
  get differenceCents() {
    return this.countedBalanceCents - this.expectedBalanceCents;
  },
  movements: [
    { time: '08:00', type: 'ABERTURA', amountCents: 20_000, note: 'Saldo inicial' },
    { time: '09:42', type: 'VENDA', amountCents: 32_000, note: 'Pedido #1031 (dinheiro)' },
    { time: '10:15', type: 'SUPRIMENTO', amountCents: 10_000, note: 'Reforço de troco' },
    { time: '11:50', type: 'VENDA', amountCents: 29_500, note: 'Pedido #1036 (dinheiro)' },
    { time: '13:05', type: 'SANGRIA', amountCents: -15_000, note: 'Depósito bancário' },
    { time: '14:30', type: 'VENDA', amountCents: 41_000, note: 'Pedido #1042 (dinheiro)' },
    { time: '16:10', type: 'VENDA', amountCents: 25_500, note: 'Pedido #1049 (dinheiro)' },
  ] as DemoCashMovement[],
};
