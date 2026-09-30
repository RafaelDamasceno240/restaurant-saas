'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  ImageIcon,
  Minus,
  Plus,
  QrCode,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { categoriesApi, productsApi } from '@/lib/cardapio-api';
import { createIdempotencyKey } from '@/lib/idempotency-key';
import { createPosOrder } from '@/lib/pos-api';
import { useActiveBranch } from '@/lib/use-active-branch';
import { AdminOrderDetail } from '@/lib/orders-api';
import { PaymentMethod } from '@/lib/checkout-api';
import {
  PosCartItem,
  addToCart,
  decrementItem,
  filterPosProducts,
  getSubtotalCents,
  getTotalQuantity,
  incrementItem,
  removeItem,
} from '@/lib/pos-logic';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Input, SearchInput } from '@/components/ds/Input';
import { Tooltip } from '@/components/ds/Tooltip';
import clsx from 'clsx';

function formatBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string; icon: typeof Banknote }[] = [
  { value: 'CASH', label: 'Dinheiro', icon: Banknote },
  { value: 'PIX', label: 'Pix', icon: QrCode },
  { value: 'CARD', label: 'Cartão', icon: CreditCard },
];

// Only the counter (Balcão) flow exists in the backend today; the other
// modes are shown so the screen keeps the shape of a full PDV, but they are
// disabled (or link to the screen that already handles them).
const MODES = [
  { key: 'delivery', label: 'Delivery', soon: true },
  { key: 'balcao', label: 'Balcão', active: true },
  { key: 'retirada', label: 'Retirada', soon: true },
  { key: 'mesas', label: 'Mesas/Comandas', href: '/dashboard/mesas' },
] as const;

export default function PdvPage() {
  const { accessToken } = useAuth();
  const { branchId } = useActiveBranch();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const saleKeyRef = useRef<string | null>(null);

  // PDV state is deliberately its own — NOT the public CartContext, NOT its
  // localStorage key. A sale here always starts empty and never persists
  // across a reload; see docs/PROJECT_STATUS.md "Fatia 07".
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<AdminOrderDetail | null>(null);
  const [cartOpen, setCartOpen] = useState(false); // small screens: cart is a full-screen sheet

  const categoriesQuery = useQuery({
    queryKey: ['pdv-categories'],
    queryFn: () => categoriesApi.list(accessToken as string),
    enabled: !!accessToken,
  });
  const productsQuery = useQuery({
    queryKey: ['pdv-products'],
    queryFn: () => productsApi.list(accessToken as string),
    enabled: !!accessToken,
  });

  const products = productsQuery.data ?? [];
  const visibleProducts = filterPosProducts(products, search, categoryId);
  const subtotalCents = getSubtotalCents(cart);
  const totalQuantity = getTotalQuantity(cart);

  function addProduct(product: { id: string; name: string; price: number }) {
    setCart((prev) =>
      addToCart(prev, {
        productId: product.id,
        name: product.name,
        priceCents: Math.round(product.price * 100),
      }),
    );
  }

  function resetSale() {
    saleKeyRef.current = null;
    setCart([]);
    setSearch('');
    setCategoryId(null);
    setCustomerName('');
    setCustomerPhone('');
    setPaymentMethod('CASH');
    setError(null);
    setConfirmation(null);
    setCartOpen(false);
  }

  async function handleFinalize() {
    if (cart.length === 0) {
      setError('Adicione ao menos um produto à venda.');
      return;
    }
    if (!branchId) {
      setError('Selecione a unidade da venda.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      saleKeyRef.current ??= createIdempotencyKey();
      const order = await createPosOrder(accessToken as string, {
        branchId,
        items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        paymentMethod,
        idempotencyKey: saleKeyRef.current,
      });
      saleKeyRef.current = null;
      setConfirmation(order);
      // A CASH sale adds a SALE movement to the open cash session.
      queryClient.invalidateQueries({ queryKey: ['cash-current'] });
    } catch (err) {
      if (err instanceof ApiError) saleKeyRef.current = null;
      setError(
        err instanceof ApiError
          ? err.code === 'CASH_REGISTER_NOT_OPEN'
            ? `${err.message} (Menu: Caixa → Abrir caixa)`
            : err.message
          : 'Não foi possível finalizar a venda.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  // Keyboard flow for a fast counter: "/" jumps to search, F9 finalizes.
  // Refs keep the listener stable while still seeing the latest handler.
  const finalizeRef = useRef(handleFinalize);
  finalizeRef.current = handleFinalize;
  const canFinalizeRef = useRef(false);
  canFinalizeRef.current = !isSubmitting && cart.length > 0 && !confirmation;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'F9' && canFinalizeRef.current) {
        event.preventDefault();
        void finalizeRef.current();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (confirmation) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm animate-pop-in space-y-5 rounded-card border border-line bg-surface p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-8 w-8" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Venda concluída!</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pedido <span className="font-semibold text-foreground">#{confirmation.orderNumber}</span>
            </p>
          </div>
          <p className="text-3xl font-bold tracking-tight text-foreground">
            {formatBRL(Math.round(confirmation.total * 100))}
          </p>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={resetSale} autoFocus>
              Nova venda
            </Button>
            <Link href={`/dashboard/pedidos/${confirmation.id}`}>
              <Button variant="outline" size="lg" fullWidth>
                Ver pedido
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const cartPanel = (
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
            <p className="text-sm">Nenhum produto adicionado.</p>
            <p className="text-xs text-subtle">Toque em um produto para começar a venda.</p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {cart.map((item) => (
              <li key={item.productId} className="animate-fade-in px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">{item.name}</span>
                  <span className="shrink-0 text-sm font-semibold text-foreground">
                    {formatBRL(item.priceCents * item.quantity)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-ctl border border-line bg-surface-2 p-0.5">
                    <button
                      type="button"
                      onClick={() => setCart((prev) => decrementItem(prev, item.productId))}
                      aria-label={`Diminuir ${item.name}`}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-surface-hover active:scale-95"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-foreground">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setCart((prev) => incrementItem(prev, item.productId))}
                      aria-label={`Aumentar ${item.name}`}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-surface-hover active:scale-95"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-subtle">{formatBRL(item.priceCents)} un.</span>
                    <Button
                      variant="danger-ghost"
                      size="icon"
                      aria-label={`Remover ${item.name}`}
                      onClick={() => setCart((prev) => removeItem(prev, item.productId))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-line p-4">
        <div className="grid grid-cols-2 gap-2">
          <Input
            placeholder="Cliente (opcional)"
            aria-label="Cliente"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <Input
            placeholder="Telefone (opcional)"
            aria-label="Telefone"
            inputMode="tel"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
          />
        </div>

        <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-3 gap-2">
          {PAYMENT_OPTIONS.map((option) => {
            const Icon = option.icon;
            const selected = paymentMethod === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPaymentMethod(option.value)}
                className={clsx(
                  'flex h-14 flex-col items-center justify-center gap-1 rounded-ctl border text-xs font-medium transition-colors active:scale-[0.97]',
                  selected
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-line bg-surface-2 text-muted-foreground hover:border-line-strong hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-2xl font-bold tracking-tight text-foreground">{formatBRL(subtotalCents)}</span>
        </div>

        {error && <Alert>{error}</Alert>}

        <Button
          size="lg"
          fullWidth
          loading={isSubmitting}
          disabled={cart.length === 0}
          onClick={handleFinalize}
        >
          {isSubmitting ? 'Enviando...' : 'Finalizar venda'}
          {!isSubmitting && <kbd className="ml-1 hidden rounded bg-black/20 px-1.5 py-0.5 text-2xs font-semibold xl:inline">F9</kbd>}
        </Button>
      </div>
    </section>
  );

  return (
    <div className="flex h-full flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      {/* Catalog */}
      <section aria-label="Catálogo" className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
        <div role="tablist" aria-label="Modo de venda" className="flex w-max max-w-full gap-1 overflow-x-auto rounded-ctl bg-surface-2 p-1">
          {MODES.map((mode) => {
            const base = 'whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors';
            if ('active' in mode) {
              return (
                <span key={mode.key} role="tab" aria-selected className={clsx(base, 'bg-surface-hover text-foreground shadow-sm')}>
                  {mode.label}
                </span>
              );
            }
            if ('href' in mode) {
              return (
                <Link key={mode.key} href={mode.href} role="tab" aria-selected={false} className={clsx(base, 'text-muted-foreground hover:text-foreground')}>
                  {mode.label}
                </Link>
              );
            }
            return (
              <Tooltip key={mode.key} label="Em breve" side="bottom">
                <span role="tab" aria-selected={false} aria-disabled className={clsx(base, 'cursor-not-allowed text-subtle')}>
                  {mode.label}
                </span>
              </Tooltip>
            );
          })}
        </div>

        <SearchInput
          large
          ref={searchRef}
          placeholder="Buscar produto...  ( / )"
          aria-label="Buscar produto"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds the top match — barcode-scanner / keyboard flow.
            if (e.key === 'Enter' && visibleProducts.length > 0 && search.trim()) {
              e.preventDefault();
              addProduct(visibleProducts[0]);
              setSearch('');
            }
          }}
        />

        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorias">
          {[{ id: null as string | null, name: 'Todas' }, ...(categoriesQuery.data ?? [])].map((category) => {
            const active = categoryId === category.id;
            return (
              <button
                key={category.id ?? 'all'}
                type="button"
                role="tab"
                aria-selected={active}
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
          {productsQuery.isLoading ? (
            <LoadingState label="Carregando produtos..." />
          ) : productsQuery.isError ? (
            <ErrorState message="Não foi possível carregar o catálogo." onRetry={() => productsQuery.refetch()} />
          ) : visibleProducts.length === 0 ? (
            <EmptyState icon={<ShoppingCart />} title="Nenhum produto encontrado" description="Ajuste a busca ou a categoria." />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {visibleProducts.map((product) => {
                const inCart = cart.find((i) => i.productId === product.id)?.quantity ?? 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface text-left transition-all hover:border-line-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98]"
                  >
                    <span className="relative flex aspect-[4/3] w-full items-center justify-center bg-surface-2">
                      {product.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-subtle" aria-hidden />
                      )}
                      {inCart > 0 && (
                        <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground shadow">
                          {inCart}
                        </span>
                      )}
                    </span>
                    <span className="flex flex-1 flex-col gap-1 p-3">
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">{product.name}</span>
                      <span className="mt-auto text-base font-bold text-accent">{formatBRL(Math.round(product.price * 100))}</span>
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

      {cartPanel}

      {/* Small screens: sticky bar that opens the cart sheet. */}
      {!cartOpen && (
        <div className="shrink-0 border-t border-line bg-surface p-3 lg:hidden">
          <Button size="lg" fullWidth onClick={() => setCartOpen(true)} icon={<ShoppingCart className="h-5 w-5" />}>
            Ver venda · {totalQuantity} · {formatBRL(subtotalCents)}
          </Button>
        </div>
      )}
    </div>
  );
}
