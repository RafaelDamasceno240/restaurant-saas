import { apiFetch } from './api-client';

// Public contract — deliberately separate from the admin Category/Product
// types in cardapio-api.ts: this is unauthenticated, customer-facing data
// (no tenantId, no active/displayOrder, no internal fields at all).
export interface PublicMenuProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  description: string | null;
  products: PublicMenuProduct[];
}

export interface PublicMenuResponse {
  restaurant: { name: string; slug: string };
  categories: PublicMenuCategory[];
}

// Reuses the existing apiFetch (same fetching approach as the rest of the
// app) — this is a plain unauthenticated GET, so no accessToken is passed.
// Safe to call from a Server Component: apiFetch has no client-only API.
export function getPublicMenu(slug: string): Promise<PublicMenuResponse> {
  return apiFetch<PublicMenuResponse>(`/public/menu/${encodeURIComponent(slug)}`);
}
