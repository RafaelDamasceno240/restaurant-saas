'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ChevronRight, Info, Search, X } from 'lucide-react';
import type {
  PublicMenuCategory,
  PublicMenuProduct,
  PublicMenuResponse,
} from '@/lib/public-menu-api';
import { formatCentsAsBRL, toCents } from '@/lib/money';
import { describeOpening } from '@/lib/menu-display';
import { ProductImage } from './ProductImage';
import { ProductPrice } from './ProductPrice';
import { ProductRow } from './ProductRow';
import { StoreInfoDialog } from './StoreInfoDialog';
import { CartFloatingButton } from './CartFloatingButton';

const SOLD_OUT_ID = 'em-falta';

// "Água" finds "agua", "X-Búrguer" finds "burguer".
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// The public menu of one restaurant: cover, store card, highlights, category tabs that follow
// the scroll, and the product list (sold-out products at the end, under "Em falta"). Every color
// comes from the theme tokens, tinted by the restaurant's own brand color: nothing here is
// specific to one restaurant.
export function Storefront({ menu, slug }: { menu: PublicMenuResponse; slug: string }) {
  const { restaurant, delivery } = menu;
  const [query, setQuery] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Server render and first paint use the server's openNow; the exact line ("abre quinta às
  // 19:00") is computed after mount, in the restaurant's time zone.
  const [opening, setOpening] = useState(() => ({
    open: restaurant.openNow,
    text: restaurant.openNow === null ? '' : restaurant.openNow ? 'Aberto agora' : 'Fechado agora',
  }));
  useEffect(() => {
    const update = () => {
      const status = describeOpening(restaurant.openingHours, new Date(), restaurant.timeZone);
      if (status.text) setOpening(status);
    };
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [restaurant.openingHours, restaurant.timeZone]);

  const sections = useMemo(() => {
    const available: PublicMenuCategory[] = menu.categories
      .map((c) => ({ ...c, products: c.products.filter((p) => !p.soldOut) }))
      .filter((c) => c.products.length > 0);
    const soldOut = menu.categories.flatMap((c) => c.products.filter((p) => p.soldOut));
    return soldOut.length
      ? [...available, { id: SOLD_OUT_ID, name: 'Em falta', description: null, products: soldOut }]
      : available;
  }, [menu.categories]);

  const featured = useMemo(
    () => menu.categories.flatMap((c) => c.products).filter((p) => p.featured && !p.soldOut),
    [menu.categories],
  );

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return null;
    return menu.categories
      .flatMap((c) => c.products)
      .filter((p) => fold(`${p.name} ${p.description ?? ''}`).includes(q));
  }, [menu.categories, query]);

  const fee = toCents(delivery.fee);
  const freeAbove = delivery.freeAbove ? toCents(delivery.freeAbove) : null;
  const minOrder = toCents(delivery.minOrder);
  const place = [restaurant.address?.neighborhood, restaurant.address?.city]
    .filter(Boolean)
    .join(', ');

  return (
    <main className="min-h-screen pb-28">
      {/* Capa */}
      <div className="relative h-40 w-full overflow-hidden bg-primary sm:h-56">
        {restaurant.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={restaurant.coverUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            aria-hidden
            className="h-full w-full bg-gradient-to-br from-primary to-primary-hover"
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/10 to-black/40"
        />
        <div className="absolute right-3 top-3 flex gap-2">
          <button
            type="button"
            onClick={() => {
              searchRef.current?.focus();
              searchRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }}
            aria-label="Buscar no cardápio"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow backdrop-blur transition hover:bg-white"
          >
            <Search className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            aria-label="Informações da loja"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow backdrop-blur transition hover:bg-white"
          >
            <Info className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative mx-auto -mt-8 max-w-2xl sm:px-4">
        {/* Cartão da loja */}
        <section className="rounded-t-3xl border-x border-t border-line bg-surface px-4 pb-4 pt-5 sm:rounded-3xl sm:border sm:shadow-sm">
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="flex w-full items-center gap-3 text-left"
            aria-label={`Informações de ${restaurant.name}`}
          >
            {restaurant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={restaurant.logoUrl}
                alt=""
                className="h-16 w-16 shrink-0 rounded-2xl border border-line object-cover"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary text-2xl font-bold text-primary-foreground"
              >
                {restaurant.name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              {opening.text && (
                <p
                  className={clsx(
                    'flex items-center gap-1.5 text-xs font-semibold',
                    opening.open ? 'text-success' : 'text-danger',
                  )}
                >
                  <span
                    aria-hidden
                    className={clsx(
                      'h-1.5 w-1.5 rounded-full',
                      opening.open ? 'bg-success' : 'bg-danger',
                    )}
                  />
                  {opening.text}
                </p>
              )}
              <h1 className="line-clamp-2 text-lg font-bold leading-tight text-foreground">
                {restaurant.name}
              </h1>
              {place && <p className="truncate text-xs text-muted-foreground">{place}</p>}
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-subtle" aria-hidden />
          </button>

          <dl className="mt-4 grid grid-cols-3 divide-x divide-line rounded-2xl border border-line text-center">
            <div className="px-2 py-2">
              <dt className="text-2xs text-muted-foreground">Entrega</dt>
              <dd className="text-sm font-semibold text-foreground">
                {delivery.enabled ? (fee > 0 ? formatCentsAsBRL(fee) : 'Grátis') : 'Indisponível'}
              </dd>
              {delivery.enabled && fee > 0 && freeAbove !== null && (
                <dd className="text-2xs text-success">
                  grátis acima de {formatCentsAsBRL(freeAbove)}
                </dd>
              )}
            </div>
            <div className="px-2 py-2">
              <dt className="text-2xs text-muted-foreground">Pedido mínimo</dt>
              <dd className="text-sm font-semibold text-foreground">
                {delivery.enabled && minOrder > 0 ? formatCentsAsBRL(minOrder) : '—'}
              </dd>
            </div>
            <div className="px-2 py-2">
              <dt className="text-2xs text-muted-foreground">Retirada</dt>
              <dd className="text-sm font-semibold text-foreground">No local</dd>
            </div>
          </dl>
        </section>

        <div className="border-x border-line bg-surface sm:mt-4 sm:rounded-3xl sm:border sm:shadow-sm">
          {/* Busca + abas (fixas no topo ao rolar) */}
          {/* No overflow:hidden on the card: it would stop the bar from sticking. */}
          <div className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur sm:rounded-t-3xl">
            <div className="px-4 pt-3">
              <label className="relative block">
                <span className="sr-only">Buscar no cardápio</span>
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
                  aria-hidden
                />
                <input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar no cardápio"
                  className="h-10 w-full rounded-full border border-line bg-surface-2 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary focus:bg-surface"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Limpar busca"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </label>
            </div>
            {!results && <CategoryTabs sections={sections} />}
            {results && <div className="h-3" />}
          </div>

          {results ? (
            <section aria-live="polite" className="pb-4">
              <h2 className="px-4 pb-1 pt-4 text-sm font-semibold text-muted-foreground">
                {results.length === 0
                  ? `Nada encontrado para "${query.trim()}"`
                  : `${results.length} resultado(s)`}
              </h2>
              <ul className="divide-y divide-line">
                {results.map((p) => (
                  <ProductRow key={p.id} product={p} slug={slug} />
                ))}
              </ul>
            </section>
          ) : sections.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Este restaurante ainda não publicou itens no cardápio.
            </p>
          ) : (
            <>
              {featured.length > 0 && <FeaturedStrip products={featured} slug={slug} />}
              {sections.map((section) => (
                <section
                  key={section.id}
                  id={`categoria-${section.id}`}
                  data-section={section.id}
                  className="scroll-mt-28"
                >
                  <h2 className="px-4 pb-1 pt-6 text-lg font-bold text-foreground">
                    {section.name}
                  </h2>
                  {section.description && (
                    <p className="px-4 text-sm text-muted-foreground">{section.description}</p>
                  )}
                  <ul className="divide-y divide-line">
                    {section.products.map((p) => (
                      <ProductRow key={p.id} product={p} slug={slug} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>

        <p className="px-4 py-6 text-center text-2xs text-subtle">
          Preços e disponibilidade conferidos ao confirmar o pedido.
        </p>
      </div>

      <CartFloatingButton restaurantSlug={slug} />
      <StoreInfoDialog
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        restaurant={restaurant}
        delivery={delivery}
      />
    </main>
  );
}

// "Destaques": products the restaurant marked as featured, in a horizontal strip.
function FeaturedStrip({ products, slug }: { products: PublicMenuProduct[]; slug: string }) {
  return (
    <section aria-label="Destaques" className="border-b border-line pb-4 pt-4">
      <h2 className="px-4 pb-3 text-lg font-bold text-foreground">Destaques</h2>
      <ul className="scrollbar-none flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4">
        {products.map((p) => (
          <li key={p.id} className="w-36 shrink-0 snap-start sm:w-40">
            <Link href={`/menu/${slug}/produto/${p.id}`} className="group block">
              <ProductImage
                src={p.imageUrl}
                alt=""
                className="aspect-square w-full rounded-2xl transition group-hover:brightness-95"
              />
              <p className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                {p.name}
              </p>
              <ProductPrice product={p} className="mt-1" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Tabs of the categories. The active one follows the section on screen; a tap scrolls to it.
function CategoryTabs({ sections }: { sections: PublicMenuCategory[] }) {
  const [active, setActive] = useState<string | null>(sections[0]?.id ?? null);
  const barRef = useRef<HTMLDivElement>(null);
  const clickedRef = useRef(0);

  useEffect(() => {
    const nodes = sections
      .map((s) => document.getElementById(`categoria-${s.id}`))
      .filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0 || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() - clickedRef.current < 800) return; // a tap is scrolling: keep its tab
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive((visible[0].target as HTMLElement).dataset.section ?? null);
      },
      { rootMargin: '-120px 0px -65% 0px' },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    const tab = barRef.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (tab && barRef.current) {
      const bar = barRef.current;
      bar.scrollTo({
        left: tab.offsetLeft - bar.clientWidth / 2 + tab.clientWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [active]);

  return (
    <nav aria-label="Categorias">
      <div ref={barRef} className="scrollbar-none flex gap-1 overflow-x-auto px-2">
        {sections.map((s) => (
          <a
            key={s.id}
            data-tab={s.id}
            href={`#categoria-${s.id}`}
            onClick={() => {
              clickedRef.current = Date.now();
              setActive(s.id);
            }}
            aria-current={active === s.id ? 'true' : undefined}
            className={clsx(
              'relative shrink-0 whitespace-nowrap px-3 pb-3 pt-3 text-sm transition-colors',
              active === s.id
                ? 'font-semibold text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {s.name}
            <span
              aria-hidden
              className={clsx(
                'absolute inset-x-3 bottom-0 h-[3px] rounded-full',
                active === s.id ? 'bg-primary' : 'bg-transparent',
              )}
            />
          </a>
        ))}
      </div>
    </nav>
  );
}
