// Types for the /demo module ONLY. Deliberately not imported from
// lib/orders-api.ts, lib/cardapio-api.ts, etc. — this module must render
// with zero network calls and zero coupling to the real API contracts, so
// that changing a real endpoint can never break the demo (and vice versa).
// Status keys mirror the real OrderStatus strings on purpose (easier to
// eyeball against the real system), but that's the only thing shared.

export type DemoOrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'COMPLETED';

export interface DemoCategory {
  id: string;
  name: string;
}

export interface DemoProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  priceCents: number;
  available: boolean;
  emoji: string;
}

export interface DemoOrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
}

export interface DemoOrder {
  orderNumber: number;
  status: DemoOrderStatus;
  items: DemoOrderItem[];
  totalCents: number;
  elapsedMinutes: number;
  customerName?: string;
  notes?: string;
}

export interface DemoCashMovement {
  time: string;
  type: 'ABERTURA' | 'VENDA' | 'SUPRIMENTO' | 'SANGRIA';
  amountCents: number;
  note: string;
}

export interface DemoStats {
  salesTodayCents: number;
  ordersToday: number;
  avgTicketCents: number;
  inPreparation: number;
  activeProducts: number;
}
