import { cache } from 'react';
import { getPublicMenu } from './public-menu-api';

// Server Components only. One API call per request, however many places ask: the segment
// layout (existence check), the page metadata and the page itself all share the same promise.
export const loadPublicMenu = cache((slug: string) => getPublicMenu(slug));
