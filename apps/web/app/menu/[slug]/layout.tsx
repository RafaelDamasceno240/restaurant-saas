import { CSSProperties, ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { loadPublicMenu } from '@/lib/public-menu-server';
import { brandCssVars } from '@/lib/menu-display';

interface LayoutProps {
  children: ReactNode;
  params: { slug: string };
}

// The restaurant is looked up HERE, above this segment's loading.tsx. A layout is rendered
// before the response starts, so an unknown (or suspended) restaurant answers a real HTTP 404
// for the menu, the cart and the checkout. Inside the page it would be too late: loading.tsx
// has already started streaming with status 200 by then, and the visitor (and every crawler)
// would get a "not found" screen that claims to be a normal page.
// Any other failure is left to the page, which has its own "try again" message.
// The restaurant's brand color (if it set one) tints every page of its menu, cart and checkout.
export default async function RestaurantMenuLayout({ children, params }: LayoutProps) {
  let brandColor: string | null = null;
  try {
    brandColor = (await loadPublicMenu(params.slug)).restaurant.brandColor ?? null;
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      notFound();
    }
  }
  return (
    <div className="theme-menu min-h-screen" style={brandCssVars(brandColor) as CSSProperties}>
      {children}
    </div>
  );
}
