import { cache } from 'react';
import { getPublicMenu } from './public-menu-api';
import { shortCache } from './short-cache';

// Server Components only. One API call per request, however many places ask: the segment
// layout (existence check), the page metadata and the page itself all share the same promise.
//
// And one call per restaurant every few seconds, however many requests: every page under
// /menu/<slug> (menu, product, cart, checkout, tracking) renders the layout, which reads the
// menu, and this server calls the API from its own address, so all visitors share one rate
// limit there. A few seconds of delay is harmless: prices, stock and opening hours are checked
// again by the API when the order is placed.
const recentMenu = shortCache(getPublicMenu, { ttlMs: 10_000, maxEntries: 200 });

export const loadPublicMenu = cache((slug: string) => recentMenu(slug));
