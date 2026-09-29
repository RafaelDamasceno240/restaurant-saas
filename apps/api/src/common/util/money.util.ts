// Single point of float contact for monetary values: round once, on the way
// in and the way out. Every module that touches price (admin CRUD, public
// menu, future orders/checkout) MUST go through these — never do arithmetic
// on the float ("reais") form beyond a single round-trip through here, and
// never duplicate this conversion locally.
export function toCents(reais: number): number {
  return Math.round(reais * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}
