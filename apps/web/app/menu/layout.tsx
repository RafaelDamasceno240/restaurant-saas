import { ReactNode } from 'react';

// The public menu is the restaurant's storefront, not the operator app: a light theme made for
// food photos (.theme-menu in app/globals.css), tinted by each restaurant's own brand color in
// app/menu/[slug]/layout.tsx. The operator app and the login keep the dark identity.
export default function ThemedLayout({ children }: { children: ReactNode }) {
  return <div className="theme-menu min-h-screen">{children}</div>;
}
