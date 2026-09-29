// Fictitious inventory for /demo/estoque ONLY. Same isolation rule as
// data.ts: no import from lib/inventory-api.ts or any real-API module, no
// fetch — a static, deterministic snapshot. See docs/DEMO_MODE.md.

export type DemoUnit = 'UN' | 'KG' | 'G' | 'L' | 'ML';
export type DemoStockStatus = 'OK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'NO_RECIPE';

export interface DemoInventoryItem {
  id: string;
  name: string;
  unit: DemoUnit;
  quantity: number;
  minStock: number;
  averageCostCents: number;
  exitLast7Days: number;
}

export interface DemoStockProduct {
  id: string;
  name: string;
  category: string;
  emoji: string;
  producibleUnits: number | null;
  soldLast7Days: number;
  status: DemoStockStatus;
}

export interface DemoStockMovement {
  id: string;
  at: string;
  type: 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'SALE' | 'SALE_REVERSAL';
  itemId: string;
  quantity: number;
  unitCostCents: number | null;
  user: string;
  reason: string | null;
  orderNumber: number | null;
}

export const demoInventoryItems: DemoInventoryItem[] = [
  { id: 'pao', name: 'Pão brioche', unit: 'UN', quantity: 18, minStock: 30, averageCostCents: 145, exitLast7Days: 212 },
  { id: 'carne', name: 'Blend bovino 150g', unit: 'KG', quantity: 12.45, minStock: 5, averageCostCents: 4290, exitLast7Days: 31.2 },
  { id: 'queijo', name: 'Queijo cheddar', unit: 'KG', quantity: 1.2, minStock: 2, averageCostCents: 5890, exitLast7Days: 6.35 },
  { id: 'bacon', name: 'Bacon fatiado', unit: 'KG', quantity: 3.8, minStock: 1.5, averageCostCents: 4450, exitLast7Days: 2.9 },
  { id: 'alface', name: 'Alface americana', unit: 'UN', quantity: 14, minStock: 6, averageCostCents: 390, exitLast7Days: 22 },
  { id: 'tomate', name: 'Tomate', unit: 'KG', quantity: 0, minStock: 3, averageCostCents: 790, exitLast7Days: 9.4 },
  { id: 'batata', name: 'Batata pré-frita', unit: 'KG', quantity: 22.5, minStock: 10, averageCostCents: 1890, exitLast7Days: 38 },
  { id: 'oleo', name: 'Óleo de soja', unit: 'L', quantity: 16, minStock: 8, averageCostCents: 890, exitLast7Days: 12 },
  { id: 'cebola', name: 'Cebola', unit: 'KG', quantity: 5.3, minStock: 2, averageCostCents: 590, exitLast7Days: 4.1 },
  { id: 'molho', name: 'Molho especial', unit: 'L', quantity: 1.8, minStock: 2, averageCostCents: 2400, exitLast7Days: 3.6 },
  { id: 'refri', name: 'Refrigerante lata', unit: 'UN', quantity: 96, minStock: 48, averageCostCents: 320, exitLast7Days: 140 },
  { id: 'embalagem', name: 'Embalagem delivery', unit: 'UN', quantity: 240, minStock: 100, averageCostCents: 85, exitLast7Days: 180 },
];

// 67 products, built deterministically so every render is identical.
const BASE: { name: string; category: string; emoji: string }[] = [
  { name: 'X-Burger', category: 'Hambúrgueres', emoji: '🍔' },
  { name: 'X-Bacon', category: 'Hambúrgueres', emoji: '🥓' },
  { name: 'X-Salada', category: 'Hambúrgueres', emoji: '🥗' },
  { name: 'Duplo Cheddar', category: 'Hambúrgueres', emoji: '🧀' },
  { name: 'Smash', category: 'Hambúrgueres', emoji: '🍔' },
  { name: 'Combo', category: 'Combos', emoji: '🍱' },
  { name: 'Batata', category: 'Porções', emoji: '🍟' },
  { name: 'Onion rings', category: 'Porções', emoji: '🧅' },
  { name: 'Refrigerante', category: 'Bebidas', emoji: '🥤' },
  { name: 'Suco', category: 'Bebidas', emoji: '🧃' },
  { name: 'Milkshake', category: 'Sobremesas', emoji: '🥛' },
];
const VARIANTS = ['Clássico', 'Especial', 'Kids', 'Família', 'Artesanal', 'Premium', 'da Casa'];

function buildProducts(total: number): DemoStockProduct[] {
  const result: DemoStockProduct[] = [];
  for (let i = 0; i < total; i++) {
    const base = BASE[i % BASE.length];
    const variant = VARIANTS[Math.floor(i / BASE.length) % VARIANTS.length];
    const noRecipe = i % 9 === 4;
    const out = i % 13 === 7;
    const low = !out && i % 5 === 2;
    const producible = noRecipe ? null : out ? 0 : low ? 3 + (i % 4) : 18 + ((i * 7) % 40);
    result.push({
      id: `p-${i + 1}`,
      name: `${base.name} ${variant}`,
      category: base.category,
      emoji: base.emoji,
      producibleUnits: producible,
      soldLast7Days: (i * 11) % 57,
      status: noRecipe ? 'NO_RECIPE' : out ? 'OUT_OF_STOCK' : low ? 'LOW_STOCK' : 'OK',
    });
  }
  return result;
}

export const demoStockProducts = buildProducts(67);

export const demoStockMovements: DemoStockMovement[] = [
  { id: 'm1', at: '28/09 21:42', type: 'SALE', itemId: 'carne', quantity: -0.3, unitCostCents: 4290, user: 'Cozinha', reason: null, orderNumber: 1049 },
  { id: 'm2', at: '28/09 21:42', type: 'SALE', itemId: 'pao', quantity: -2, unitCostCents: 145, user: 'Cozinha', reason: null, orderNumber: 1049 },
  { id: 'm3', at: '28/09 21:15', type: 'SALE_REVERSAL', itemId: 'queijo', quantity: 0.03, unitCostCents: 5890, user: 'Ana (gerente)', reason: 'Estorno por cancelamento do pedido', orderNumber: 1044 },
  { id: 'm4', at: '28/09 18:05', type: 'EXIT', itemId: 'tomate', quantity: -1.2, unitCostCents: 790, user: 'Ana (gerente)', reason: 'Perda — passou do ponto', orderNumber: null },
  { id: 'm5', at: '28/09 16:30', type: 'ENTRY', itemId: 'carne', quantity: 10, unitCostCents: 4250, user: 'Ana (gerente)', reason: 'NF 4821 — Frigorífico Sul', orderNumber: null },
  { id: 'm6', at: '28/09 16:28', type: 'ENTRY', itemId: 'refri', quantity: 48, unitCostCents: 320, user: 'Ana (gerente)', reason: null, orderNumber: null },
  { id: 'm7', at: '28/09 09:10', type: 'ADJUSTMENT', itemId: 'batata', quantity: -0.5, unitCostCents: 1890, user: 'Carlos (dono)', reason: 'Contagem de abertura', orderNumber: null },
  { id: 'm8', at: '27/09 22:50', type: 'SALE', itemId: 'bacon', quantity: -0.04, unitCostCents: 4450, user: 'Cozinha', reason: null, orderNumber: 1036 },
  { id: 'm9', at: '27/09 15:00', type: 'ENTRY', itemId: 'queijo', quantity: 2, unitCostCents: 5890, user: 'Ana (gerente)', reason: 'Laticínios Serra', orderNumber: null },
  { id: 'm10', at: '27/09 11:20', type: 'EXIT', itemId: 'embalagem', quantity: -20, unitCostCents: 85, user: 'Ana (gerente)', reason: 'Danificadas no transporte', orderNumber: null },
];

export function demoItemStatus(item: DemoInventoryItem): DemoStockStatus {
  if (item.quantity <= 0) return 'OUT_OF_STOCK';
  if (item.quantity <= item.minStock) return 'LOW_STOCK';
  return 'OK';
}
