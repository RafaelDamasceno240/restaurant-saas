import { ReactNode } from 'react';

// Same identity as the operator app (dark #020001, caramel/gold accents,
// Georgia headings): login, sign-up and the public menu are the first thing
// customers and owners see, so they must not look like a different product.
export default function ThemedLayout({ children }: { children: ReactNode }) {
  return <div className="theme-app min-h-screen">{children}</div>;
}
