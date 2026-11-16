import { apiFetch } from './api-client';

// Public contract — deliberately separate from the admin Category/Product
// types in cardapio-api.ts: this is unauthenticated, customer-facing data
// (no tenantId, no active/displayOrder, no internal fields at all).
// An add-on the customer can pick (sold-out ones are not listed). Prices in reais.
export interface PublicMenuOption {
  id: string;
  name: string;
  description: string | null;
  price: number;
  maxQuantity: number;
  imageUrl: string | null;
}

// minSelect > 0 = required; the units chosen in the group stay between minSelect and maxSelect.
export interface PublicMenuOptionGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: PublicMenuOption[];
}

export type ProductBadge = 'NEW' | 'VEGETARIAN';

export interface PublicMenuProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  // Promotion: the full price, shown struck through. Older APIs do not send the fields below.
  compareAtPrice?: number | null;
  imageUrl: string | null;
  soldOut?: boolean;
  featured?: boolean;
  badges?: ProductBadge[];
  optionGroups?: PublicMenuOptionGroup[];
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  description: string | null;
  products: PublicMenuProduct[];
}

// Delivery terms shown on the checkout. Informational: the server recomputes the
// fee and enforces the minimum when the order is created. Values are in reais.
export interface PublicMenuDelivery {
  enabled: boolean;
  fee: number;
  minOrder: number;
  // Items subtotal from which the delivery is free (reais); null = never free.
  freeAbove?: number | null;
}

// What the restaurant published in its profile. Phones as digits, Instagram without "@";
// openingHours null = never informed (and then openNow is null too).
export interface PublicRestaurant {
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  instagram: string | null;
  address: {
    street: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  } | null;
  openingHours: { weekday: number; opens: string; closes: string }[] | null;
  openNow: boolean | null;
  timeZone?: string;
  // Look of the menu; null = the neutral defaults.
  logoUrl?: string | null;
  coverUrl?: string | null;
  brandColor?: string | null;
}

export interface PublicMenuResponse {
  restaurant: PublicRestaurant;
  delivery: PublicMenuDelivery;
  categories: PublicMenuCategory[];
}

// Reuses the existing apiFetch (same fetching approach as the rest of the
// app) — this is a plain unauthenticated GET, so no accessToken is passed.
// Safe to call from a Server Component: apiFetch has no client-only API.
export function getPublicMenu(slug: string): Promise<PublicMenuResponse> {
  return apiFetch<PublicMenuResponse>(`/public/menu/${encodeURIComponent(slug)}`);
}
