'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { tablesApi } from '@/lib/tables-api';
import { Tab, tabsApi } from '@/lib/tabs-api';
import { PaymentMethod } from '@/lib/checkout-api';
import { checkoutBlockReason, TAB_PAYMENT_OPTIONS } from '@/lib/tab-checkout-logic';
import { categoriesApi, productsApi } from '@/lib/cardapio-api';
import { filterPosProducts } from '@/lib/pos-logic';
import { formatCentsAsBRL } from '@/lib/money';
import { Button } from '@/components/ds/Button';
import { Input } from '@/components/ds/Input';
import { Page } from '@/components/ds/PageHeader';
import { Alert, LoadingState } from '@/components/ds/States';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';

// A comanda's items are never local state: every add/change/remove hits the
// API immediately and re-renders from whatever it echoes back — the same
// "backend is the only source of the total" rule as checkout/PDV, just
// applied per-action instead of once at the end of a sale.
export default function MesaDetailPage() {
  const params = useParams<{ tableId: string }>();
  const tableId = params.tableId;
  const router = useRouter();
  const { user, accessToken, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const [customerName, setCustomerName] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  const [sale, setSale] = useState<Tab | null>(null);
  // One key per checkout attempt, reused on every retry of that attempt: if
  // a response is lost and the user presses again, the backend returns the
  // sale it already made instead of charging twice. Reset only on cancel.
  const checkoutKeyRef = useRef<string | null>(null);
  // Synchronous guard: state updates are async, a fast double click could
  // otherwise fire two requests before `isSubmitting` re-renders the button.
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [authLoading, user, router]);

  const tableQuery = useQuery({
    queryKey: ['table', tableId],
    queryFn: () => tablesApi.get(accessToken as string, tableId),
    enabled: !!accessToken,
    refetchInterval: 15_000,
  });
  const table = tableQuery.data;

  const tabQuery = useQuery({
    queryKey: ['tab', table?.openTabId],
    queryFn: () => tabsApi.get(accessToken as string, table!.openTabId as string),
    enabled: !!accessToken && !!table?.openTabId,
    refetchInterval: 15_000,
  });
  const tab = tabQuery.data;

  const categoriesQuery = useQuery({
    queryKey: ['mesas-categories'],
    queryFn: () => categoriesApi.list(accessToken as string),
    enabled: !!accessToken && !!tab,
  });
  const productsQuery = useQuery({
    queryKey: ['mesas-products'],
    queryFn: () => productsApi.list(accessToken as string),
    enabled: !!accessToken && !!tab,
  });
  const products = productsQuery.data ?? [];
  const visibleProducts = filterPosProducts(products, search, categoryId);

  async function invalidateAfterChange() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['table', tableId] }),
      queryClient.invalidateQueries({ queryKey: ['tab', table?.openTabId] }),
      queryClient.invalidateQueries({ queryKey: ['tables'] }),
    ]);
  }

  async function handleOpenTab(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || !table) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await tabsApi.open(accessToken, {
        branchId: table.branchId,
        tableId: table.id,
        customerName: customerName.trim() || undefined,
      });
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível abrir a comanda.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAddProduct(productId: string) {
    if (!accessToken || !tab) return;
    setError(null);
    try {
      await tabsApi.addItem(accessToken, tab.id, { productId, quantity: 1 });
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível adicionar o produto.');
    }
  }

  async function handleChangeQuantity(itemId: string, quantity: number) {
    if (!accessToken || !tab) return;
    setError(null);
    try {
      if (quantity <= 0) {
        await tabsApi.removeItem(accessToken, tab.id, itemId);
      } else {
        await tabsApi.updateItem(accessToken, tab.id, itemId, { quantity });
      }
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível atualizar o item.');
    }
  }

  function startEditingNotes(itemId: string, currentNotes: string | null) {
    setEditingNotesId(itemId);
    setNotesDraft(currentNotes ?? '');
  }

  async function handleSaveNotes(itemId: string) {
    if (!accessToken || !tab) return;
    setError(null);
    try {
      await tabsApi.updateItem(accessToken, tab.id, itemId, { notes: notesDraft.trim() });
      setEditingNotesId(null);
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a observação.');
    }
  }

  async function handleRemoveItem(itemId: string) {
    if (!accessToken || !tab) return;
    setError(null);
    try {
      await tabsApi.removeItem(accessToken, tab.id, itemId);
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível remover o item.');
    }
  }

  function openCheckout() {
    setError(null);
    setPaymentMethod(null);
    checkoutKeyRef.current = crypto.randomUUID();
    setCheckoutOpen(true);
  }

  function cancelCheckout() {
    setCheckoutOpen(false);
    setPaymentMethod(null);
    checkoutKeyRef.current = null;
  }

  async function handleCheckout() {
    if (!accessToken || !tab || !paymentMethod || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await tabsApi.checkout(accessToken, tab.id, {
        paymentMethod,
        idempotencyKey: checkoutKeyRef.current ?? crypto.randomUUID(),
      });
      setSale(result);
      setCheckoutOpen(false);
      await invalidateAfterChange();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CASH_REGISTER_NOT_OPEN') {
        setError(`${err.message} Escolha PIX/Cartão ou abra o caixa (Menu: Caixa).`);
      } else {
        setError(err instanceof ApiError ? err.message : 'Não foi possível fechar a conta.');
      }
      // Refresh branchCashRegisterOpen / tab status after a rejection.
      await invalidateAfterChange();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  if (authLoading || !user || tableQuery.isLoading) {
    return (
      <LoadingState label="Carregando..." className="py-24" />
    );
  }
  if (sale?.order) {
    const methodLabel =
      TAB_PAYMENT_OPTIONS.find((o) => o.value === sale.order!.paymentMethod)?.label ?? sale.order.paymentMethod;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-sm animate-pop-in space-y-4 rounded-card border border-line bg-surface p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/10 text-success">
            <CheckCircle2 className="h-8 w-8" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold text-foreground">Conta fechada — Mesa {sale.table.number}</h1>
          <p className="text-sm text-muted-foreground">
            Pedido <span className="font-semibold text-foreground">#{sale.order.orderNumber}</span>
          </p>
          <p className="text-3xl font-bold tracking-tight text-foreground">{formatCentsAsBRL(sale.order.totalCents)}</p>
          <p className="inline-block rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
            {sale.order.payment?.status === 'CONFIRMED' ? 'Pagamento confirmado' : 'Pagamento pendente'} · {methodLabel}
          </p>
          <Link href="/dashboard/mesas" className="block">
            <Button size="lg" fullWidth>
              Voltar para mesas
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (tableQuery.isError || !table) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 py-24">
        <p className="text-sm text-danger">Mesa não encontrada.</p>
        <Link href="/dashboard/mesas" className="text-sm text-muted-foreground underline hover:text-foreground">
          ← Voltar para mesas
        </Link>
      </div>
    );
  }

  return (
    <Page wide>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/dashboard/mesas"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Mesas
        </Link>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Mesa {table.number}
          {table.name ? ` — ${table.name}` : ''}
        </h1>
      </div>

      {error && <Alert>{error}</Alert>}

      {table.status === 'AVAILABLE' ? (
        <form onSubmit={handleOpenTab} className="mx-auto max-w-md space-y-3 rounded-card border border-line bg-surface p-5">
          <p className="text-sm font-semibold text-foreground">Mesa disponível — abrir comanda</p>
          <Input
            placeholder="Cliente (opcional)"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
          />
          <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
            {isSubmitting ? 'Abrindo...' : 'Abrir comanda'}
          </Button>
        </form>
      ) : !tab || tabQuery.isLoading ? (
        <LoadingState label="Carregando comanda..." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
          {/* Catalog */}
          <section className="flex min-h-0 flex-col gap-3">
            <Input placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCategoryId(null)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                  categoryId === null ? 'bg-primary text-primary-foreground' : 'bg-surface-hover text-muted-foreground hover:text-foreground'
                }`}
              >
                Todas
              </button>
              {(categoriesQuery.data ?? []).map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setCategoryId(category.id)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                    categoryId === category.id ? 'bg-primary text-primary-foreground' : 'bg-surface-hover text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>

            {productsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando produtos...</p>
            ) : visibleProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum produto encontrado.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {visibleProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => handleAddProduct(product.id)}
                    className="flex flex-col items-start gap-1 rounded-card border border-line bg-surface p-3 text-left hover:border-accent hover:bg-surface-hover"
                  >
                    <span className="font-medium">{product.name}</span>
                    <span className="text-sm font-bold">{formatCentsAsBRL(Math.round(product.price * 100))}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Current tab */}
          <section className="flex min-h-0 flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <h2 className="text-lg font-bold text-foreground">Comanda {tab.customerName ? `— ${tab.customerName}` : ''}</h2>

            {tab.items.length === 0 ? (
              <p className="flex-1 text-sm text-subtle">Nenhum item adicionado.</p>
            ) : (
              <ul className="flex-1 space-y-2 overflow-y-auto">
                {tab.items.map((item) => (
                  <li key={item.id} className="rounded-ctl border border-line bg-surface-2 p-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{item.name}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="text-xs text-danger underline"
                      >
                        Remover
                      </button>
                    </div>
                    {editingNotesId === item.id ? (
                      <div className="mt-1 flex items-center gap-1">
                        <input
                          autoFocus
                          type="text"
                          value={notesDraft}
                          onChange={(e) => setNotesDraft(e.target.value)}
                          placeholder="Observação (ex.: sem cebola)"
                          maxLength={300}
                          className="flex-1 rounded-lg border border-line-strong bg-surface-2 px-2 py-1 text-xs text-foreground outline-none focus:border-accent"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveNotes(item.id)}
                          className="text-xs font-medium text-accent underline"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingNotesId(null)}
                          className="text-xs text-muted-foreground underline"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditingNotes(item.id, item.notes)}
                        className="mt-0.5 block text-left text-xs text-muted-foreground underline decoration-dotted"
                      >
                        {item.notes || 'Adicionar observação'}
                      </button>
                    )}
                    <div className="mt-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleChangeQuantity(item.id, item.quantity - 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-sm font-bold text-foreground hover:bg-surface-hover active:scale-95"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-sm font-medium">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleChangeQuantity(item.id, item.quantity + 1)}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-sm font-bold text-foreground hover:bg-surface-hover active:scale-95"
                        >
                          +
                        </button>
                      </div>
                      <span className="text-sm font-semibold">{formatCentsAsBRL(item.subtotalCents)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-line pt-2 text-lg font-bold text-foreground">
              <span>Total ({tab.itemCount})</span>
              <span>{formatCentsAsBRL(tab.totalCents)}</span>
            </div>

            {!checkoutOpen ? (
              <Button size="lg" fullWidth disabled={tab.items.length === 0} onClick={openCheckout}>
                Fechar conta
              </Button>
            ) : (
              <CheckoutPanel
                itemCount={tab.itemCount}
                subtotalCents={tab.subtotalCents}
                totalCents={tab.totalCents}
                paymentMethod={paymentMethod}
                onPaymentMethod={setPaymentMethod}
                cashRegisterOpen={tab.branchCashRegisterOpen ?? false}
                isSubmitting={isSubmitting}
                onConfirm={handleCheckout}
                onCancel={cancelCheckout}
              />
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

// Summary + payment choice. The totals shown are the ones the API returned
// for this tab — the sale is charged server-side from the same snapshots.
function CheckoutPanel({
  itemCount,
  subtotalCents,
  totalCents,
  paymentMethod,
  onPaymentMethod,
  cashRegisterOpen,
  isSubmitting,
  onConfirm,
  onCancel,
}: {
  itemCount: number;
  subtotalCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  onPaymentMethod: (method: PaymentMethod) => void;
  cashRegisterOpen: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const blockReason = checkoutBlockReason({ itemCount, paymentMethod, cashRegisterOpen });
  return (
    <div className="space-y-3 rounded-ctl border border-line bg-surface-2 p-3">
      <p className="text-sm font-semibold">Fechar conta</p>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Itens</dt>
          <dd>{itemCount}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd>{formatCentsAsBRL(subtotalCents)}</dd>
        </div>
        <div className="flex justify-between text-base font-bold">
          <dt>Total</dt>
          <dd>{formatCentsAsBRL(totalCents)}</dd>
        </div>
      </dl>

      <fieldset className="space-y-1" disabled={isSubmitting}>
        <legend className="mb-1 text-xs text-muted-foreground">Forma de pagamento</legend>
        {TAB_PAYMENT_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              className="accent-[rgb(var(--primary))]"
              name="tab-payment-method"
              value={option.value}
              checked={paymentMethod === option.value}
              onChange={() => onPaymentMethod(option.value)}
            />
            {option.label}
            {option.value === 'CASH' && !cashRegisterOpen && (
              <span className="text-xs text-warning">(caixa fechado)</span>
            )}
          </label>
        ))}
      </fieldset>

      {blockReason && paymentMethod && <p className="text-xs text-warning">{blockReason}</p>}

      <div className="flex gap-2">
        <Button className="flex-1" loading={isSubmitting} disabled={blockReason !== null} onClick={onConfirm}>
          {isSubmitting ? 'Processando...' : 'Confirmar pagamento'}
        </Button>
        <Button variant="outline" disabled={isSubmitting} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
