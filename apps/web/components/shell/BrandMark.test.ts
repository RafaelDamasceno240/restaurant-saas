import { act, createElement as h } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { BrandMark, brandInitials } from './BrandMark';
import { Sidebar } from './Sidebar';

// The panel shows each restaurant's own identity: its logo, or its initials when it has none.
// Nothing of a specific restaurant is fixed in the shell (it used to print one logo for all).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderSidebar(brandName: string, brandLogoUrl: string | null, collapsed = false) {
  act(() =>
    root.render(
      h(Sidebar, {
        groups: [],
        pathname: '/dashboard',
        collapsed,
        onToggleCollapsed: () => undefined,
        brandHref: '/dashboard',
        brandName,
        brandLogoUrl,
        user: { name: 'Ana Souza', email: 'ana@example.com' },
      }),
    ),
  );
}

describe('brandInitials', () => {
  it('takes the first letters of the first two words, skipping punctuation and connectors', () => {
    expect(brandInitials("Do'cê Hamburgueria")).toBe('DH');
    expect(brandInitials('Cantina da Nona')).toBe('CN');
    expect(brandInitials('  pizzaria  ')).toBe('P');
    expect(brandInitials("'' --")).toBe('?');
  });
});

describe('BrandMark', () => {
  it('shows the logo with the name as its text when it stands alone', () => {
    act(() =>
      root.render(
        h(BrandMark, { name: 'Cantina', logoUrl: '/api/public/media/abc', className: 'h-9 w-9' }),
      ),
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/public/media/abc');
    expect(img?.getAttribute('alt')).toBe('Cantina');
  });

  it('shows the initials, named for screen readers, when there is no logo', () => {
    act(() =>
      root.render(h(BrandMark, { name: 'Cantina da Nona', logoUrl: null, className: 'h-9 w-9' })),
    );
    expect(container.querySelector('img')).toBeNull();
    const mark = container.querySelector('[role="img"]');
    expect(mark?.getAttribute('aria-label')).toBe('Cantina da Nona');
    expect(mark?.textContent).toBe('CN');
  });
});

describe('Sidebar brand', () => {
  it('two restaurants each see their own name and logo', () => {
    renderSidebar("Do'cê Hamburgueria", '/api/public/media/logo-doce');
    expect(container.textContent).toContain("Do'cê Hamburgueria");
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/public/media/logo-doce');

    renderSidebar('Cantina da Nona', null);
    expect(container.textContent).toContain('Cantina da Nona');
    expect(container.textContent).not.toContain("Do'cê");
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('CN');
  });

  it('collapsed, the link is named after the restaurant shown', () => {
    renderSidebar('Cantina da Nona', null, true);
    const link = container.querySelector('a[href="/dashboard"]');
    expect(link?.getAttribute('aria-label')).toBe('Cantina da Nona');
    expect(container.innerHTML).not.toContain('doce-logo');
  });
});
