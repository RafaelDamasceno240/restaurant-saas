'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { Banknote, CheckCircle2, CreditCard, Minus, Plus, QrCode, ShoppingCart, Trash2, X } from 'lucide-react';
import { demoCategories, demoProducts } from '@/lib/demo/data';
import { formatDemoBRL } from '@/lib/demo/format';
import {
  DemoCartItem,
  addToCart,
  decrementItem,
  getSubtotalCents,
  incrementItem,
  removeItem,
} from '@/lib/demo/pdv-logic';
import { Alert, EmptyState } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Input, SearchInput } from '@/components/ds/Input';

type PaymentMethod = 'CASH' | 'PIX' | 'CARD';

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CARD: 'Cartão',
};
const PAYMENT_ICON = { CASH: Banknote, PIX: QrCode, CARD: CreditCard } as const;

export default function DemoPdvPage() {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<DemoCartItem[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [payment, setPayment] = useState<PaymentMethod>('CASH');
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const term = search.trim().toLowerCase();
  const products = demoProducts.filter(
    (p) =>
      p.available &&
      (!categoryId || p.categoryId === categoryId) &&
      (!term || p.name.toLowerCase().includes(term)),
  );
  const subtotalCents = getSubtotalCents(cart);
  const totalQuantity = cart.reduce((sum, i) => sum + i.quantity, 0);

  function handleFinalize() {
    if (cart.length === 0) return;
    // No network call, no Order created — purely a local confirmation
    // banner, exactly as requested ("não criar pedido real").
    setConfirmation(
      `Venda demonstrativa finalizada — ${formatDemoBRL(subtotalCents)} em ${PAYMENT_LABEL[payment]}${
        customerName ? ` para ${customerName}` : ''
      }.`,
    );
    setCart([]);
    setCustomerName('');
    setPayment('CASH');
    setCartOpen(false);
  }

  return (
    <div className="flex h-full flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      <section aria-label="Catálogo" className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="flex w-max max-w-full gap-1 overflow-x-auto rounded-ctl bg-surface-2 p-1">
          {['Delivery', 'Balcão', 'Retirada', 'Mesas/Comandas'].map((mode) => (
            <span
              key={mode}
              className={clsx(
                'whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium',
                mode === 'Balcão' ? 'bg-surface-hover text-foreground shadow-sm' : 'text-subtle',
              )}
            >
              {mode}
            </span>
          ))}
        </div>

        {confirmation && (
          <Alert tone="success" className="animate-fade-in">
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                {confirmation}
              </p>
              <button type="button" onClick={() => setConfirmation(null)} aria-label="Fechar aviso" className="opacity-70 hover:opacity-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          </Alert>
        )}

        <SearchInput
          large
          placeholder="Buscar produto..."
          aria-label="Buscar produto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex gap-2 overflow-x-auto pb-1">
          {[{ id: null as string | null, name: 'Todas' }, ...demoCategories].map((category) => {
            const active = categoryId === category.id;
            return (
              <button
                key={category.id ?? 'all'}
                type="button"
                onClick={() => setCategoryId(category.id)}
                className={clsx(
                  'h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors active:scale-[0.97]',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-line bg-surface text-muted-foreground hover:border-line-strong hover:text-foreground',
                )}
              >
                {category.name}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {products.length === 0 ? (
            <EmptyState icon={<ShoppingCart />} title="Nenhum produto encontrado" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => {
                const inCart = cart.find((i) => i.productId === product.id)?.quantity ?? 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() =>
                      setCart((items) =>
                        addToCart(items, { productId: product.id, name: product.name, priceCents: product.priceCents }),
                      )
                    }
                    className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface text-left transition-all hover:border-line-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98]"
                  >
                    <span className="relative flex aspect-[4/3] w-full items-center justify-center bg-surface-2 text-5xl" aria-hidden>
                      {product.emoji}
                      {inCart > 0 && (
                        <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                          {inCart}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 flex-col gap-1 p-3">
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{product.name}</span>
                      <span className="mt-auto text-base font-bold text-accent">{formatDemoBRL(product.priceCents)}</span>
                      <span className="mt-1 flex h-9 items-center justify-center gap-1.5 rounded-ctl bg-accent/10 text-xs font-semibold text-accent transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        Adicionar
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section
        aria-label="Venda atual"
        className={clsx(
          'min-h-0 flex-col border-line bg-surface lg:flex lg:border-l',
          cartOpen ? 'fixed inset-0 z-40 flex animate-fade-in' : 'hidden',
        )}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Venda atual</h2>
            <p className="text-xs text-muted-foreground">
              {totalQuantity} item{totalQuantity === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {cart.length > 0 && (
              <Button variant="danger-ghost" size="sm" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setCart([])}>
                Limpar
              </Button>
            )}
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Fechar venda" onClick={() => setCartOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
              <ShoppingCart className="h-8 w-8 text-subtle" aria-hidden />
              <p className="text-sm">Nenhum item ainda.</p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {cart.map((item) => (
                <li key={item.productId} className="animate-fade-in px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    <span className="shrink-0 text-sm font-semibold text-foreground">
                      {formatDemoBRL(item.priceCents * item.quantity)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1 rounded-ctl border border-line bg-surface-2 p-0.5">
                      <button
                        type="button"
                        onClick={() => setCart((items) => decrementItem(items, item.productId))}
                        aria-label={`Diminuir ${item.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-surface-hover active:scale-95"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-7 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => setCart((items) => incrementItem(items, item.productId))}
                        aria-label={`Aumentar ${item.name}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-surface-hover active:scale-95"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <Button
                      variant="danger-ghost"
                      size="icon"
                      aria-label={`Remover ${item.name}`}
                      onClick={() => setCart((items) => removeItem(items, item.productId))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t border-line p-4">
          <Input
            placeholder="Cliente (opcional)"
            aria-label="Cliente"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />

          <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-3 gap-2">
            {(['CASH', 'PIX', 'CARD'] as PaymentMethod[]).map((method) => {
              const Icon = PAYMENT_ICON[method];
              const selected = payment === method;
              return (
                <button
                  key={method}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setPayment(method)}
                  className={clsx(
                    'flex h-14 flex-col items-center justify-center gap-1 rounded-ctl border text-xs font-medium transition-colors active:scale-[0.97]',
                    selected
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-line bg-surface-2 text-muted-foreground hover:border-line-strong hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {PAYMENT_LABEL[method]}
                </button>
              );
            })}
          </div>

          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-2xl font-bold tracking-tight text-foreground">{formatDemoBRL(subtotalCents)}</span>
          </div>

          <Button size="lg" fullWidth disabled={cart.length === 0} onClick={handleFinalize}>
            Finalizar venda
          </Button>
        </div>
      </section>

      {!cartOpen && (
        <div className="shrink-0 border-t border-line bg-surface p-3 lg:hidden">
          <Button size="lg" fullWidth onClick={() => setCartOpen(true)} icon={<ShoppingCart className="h-5 w-5" />}>
            Ver venda · {totalQuantity} · {formatDemoBRL(subtotalCents)}
          </Button>
        </div>
      )}
    </div>
  );
}
