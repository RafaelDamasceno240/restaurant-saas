'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { tablesApi } from '@/lib/tables-api';
import { Tab, TabItem, tabsApi } from '@/lib/tabs-api';
import { PaymentMethod } from '@/lib/checkout-api';
import { checkoutBlockReason, paidWithLabel, TAB_PAYMENT_OPTIONS } from '@/lib/tab-checkout-logic';
import { categoriesApi, productsApi } from '@/lib/cardapio-api';
import { filterPosProducts } from '@/lib/pos-logic';
import { formatCentsAsBRL } from '@/lib/money';
import { MAX_UNITS_HINT, atUnitLimit } from '@/lib/cart-logic';
import {
  addToDraft,
  cancelNeedsManager,
  canServe,
  draftTotalCents,
  draftUnits,
  itemsNotDelivered,
  loadDraft,
  RoundDraft,
  saveDraft,
  setDraftNotes,
  setDraftQuantity,
  TAB_ITEM_STATUS_LABEL,
  tabUnitsOfProduct,
  toRoundItems,
  unsentLabel,
} from '@/lib/tab-round-logic';
import { hasPermission } from '@/lib/permissions';
import { Button } from '@/components/ds/Button';
import { Input } from '@/components/ds/Input';
import { Page } from '@/components/ds/PageHeader';
import { Alert, LoadingState } from '@/components/ds/States';
import { ArrowLeft, CheckCircle2, ChefHat, Send } from 'lucide-react';
import { TabItemCancelDialog } from '@/components/tabs/TabItemCancelDialog';
import { CustomerPicker, PickedCustomer } from '@/components/customers/CustomerPicker';
import { CashbackUseField } from '@/components/cashback/CashbackUseField';
import { parseCashbackToUse, validateCashbackToUse } from '@/lib/cashback-logic';
import { receivableErrorMessage } from '@/lib/receivables-logic';

// B9: the waiter builds a ROUND here (a draft on this device: add, remove, change quantities and
// notes freely) and sends it whole with "Enviar para a cozinha". Sent items come from the API
// only — the same "backend is the only source of the total" rule as checkout/PDV — and are never
// edited: more units = a new round, fewer = a cancellation (with a reason).
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
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(null);
  // Optional customer of the registry for this sale. Waiters close tabs but cannot see the
  // customer registry (the API refuses a customerId from them), so the picker is hidden.
  const [saleCustomer, setSaleCustomer] = useState<PickedCustomer | null>(null);
  // Cashback of that customer to spend on this bill (only the amount is sent; the API checks it).
  const [cashbackInput, setCashbackInput] = useState('');
  const [cashbackMaxCents, setCashbackMaxCents] = useState(0);
  const canLinkCustomer = (user?.roles ?? []).some((role) => ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'].includes(role));
  // B12: a CASHIER sees tables and tabs (tables.read, tabs.read), but opening, changing and closing
  // a tab belong to the waiter and management: the controls are hidden or off instead of ending in 403.
  const canOpenTab = hasPermission(user?.roles, 'tabs.create');
  const canEditTab = hasPermission(user?.roles, 'tabs.update');
  const canCloseTab = hasPermission(user?.roles, 'tabs.close');
  // B9: once the kitchen has an item (or it was delivered), cancelling it is for orders.cancel.
  const canCancelStarted = hasPermission(user?.roles, 'orders.cancel');
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
    // B9: often enough for the waiter to see the kitchen's "Pronto" without asking.
    refetchInterval: 10_000,
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

  // B9: the round being built lives on this device (and its storage) until it is sent.
  const [draft, setDraft] = useState<RoundDraft>([]);
  const [draftTabId, setDraftTabId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  // One key per send attempt, reused on retries of that same draft (a lost response then returns
  // the round already made instead of sending it twice). Any change to the draft drops it.
  const sendKeyRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const [cancelTarget, setCancelTarget] = useState<TabItem | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [servingId, setServingId] = useState<string | null>(null);

  useEffect(() => {
    if (tab?.id && tab.id !== draftTabId) {
      setDraft(loadDraft(tab.id));
      setDraftTabId(tab.id);
    }
  }, [tab?.id, draftTabId]);

  function updateDraft(next: RoundDraft) {
    sendKeyRef.current = null;
    setDraft(next);
    if (draftTabId) saveDraft(draftTabId, next);
  }

  function handleAddProduct(product: { id: string; name: string; price: number }) {
    if (!tab) return;
    setError(null);
    updateDraft(addToDraft(draft, { id: product.id, name: product.name, priceCents: Math.round(product.price * 100) }));
  }

  async function handleSendRound() {
    if (!accessToken || !tab || draft.length === 0 || sendingRef.current) return;
    sendingRef.current = true;
    setIsSending(true);
    setError(null);
    sendKeyRef.current ??= crypto.randomUUID();
    try {
      await tabsApi.sendRound(accessToken, tab.id, { idempotencyKey: sendKeyRef.current, items: toRoundItems(draft) });
      updateDraft([]);
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível enviar para a cozinha. Tente novamente.');
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  async function handleServe(itemId: string) {
    if (!accessToken || !tab) return;
    setError(null);
    setServingId(itemId);
    try {
      await tabsApi.serveItem(accessToken, tab.id, itemId);
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível marcar como entregue.');
      await invalidateAfterChange();
    } finally {
      setServingId(null);
    }
  }

  async function handleCancelItem(input: { quantity: number; reason: string; returnToStock?: boolean }): Promise<boolean> {
    if (!accessToken || !tab || !cancelTarget) return false;
    setCancelError(null);
    try {
      await tabsApi.cancelItem(accessToken, tab.id, cancelTarget.id, input);
      await invalidateAfterChange();
      return true;
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : 'Não foi possível cancelar o item.');
      await invalidateAfterChange();
      return false;
    }
  }

  async function handleCloseEmpty() {
    if (!accessToken || !tab || submittingRef.current) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      await tabsApi.closeEmpty(accessToken, tab.id);
      updateDraft([]);
      await invalidateAfterChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível liberar a mesa.');
      await invalidateAfterChange();
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function openCheckout() {
    setError(null);
    setPaymentMethod(null);
    setSaleCustomer(null);
    setCashbackInput('');
    setCashbackMaxCents(0);
    checkoutKeyRef.current = crypto.randomUUID();
    setCheckoutOpen(true);
  }

  function cancelCheckout() {
    setCheckoutOpen(false);
    setPaymentMethod(null);
    setSaleCustomer(null);
    setCashbackInput('');
    setCashbackMaxCents(0);
    checkoutKeyRef.current = null;
  }

  async function handleCheckout() {
    if (!accessToken || !tab || !paymentMethod || submittingRef.current) return;
    const cashbackProblem = saleCustomer ? validateCashbackToUse(cashbackInput, cashbackMaxCents) : null;
    if (cashbackProblem) {
      setError(cashbackProblem);
      return;
    }
    const cashbackCents = saleCustomer ? (parseCashbackToUse(cashbackInput) ?? 0) : 0;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await tabsApi.checkout(accessToken, tab.id, {
        paymentMethod,
        idempotencyKey: checkoutKeyRef.current ?? crypto.randomUUID(),
        ...(saleCustomer ? { customerId: saleCustomer.id } : {}),
        ...(cashbackCents > 0 ? { cashbackToUseCents: cashbackCents } : {}),
      });
      setSale(result);
      setCheckoutOpen(false);
      await invalidateAfterChange();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CASH_REGISTER_NOT_OPEN') {
        setError(`${err.message} Escolha PIX/Cartão ou abra o caixa (Menu: Caixa).`);
      } else {
        // Known codes get a friendlier text; other codes keep the API message.
        setError(err instanceof ApiError ? receivableErrorMessage(err.code, err.message) : 'Não foi possível fechar a conta.');
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
    const methodLabel = paidWithLabel(sale.order.paymentMethod);
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
            {`${sale.order.payment?.status === 'CONFIRMED' ? 'Pagamento confirmado' : 'Pagamento pendente'} · ${methodLabel}`}
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
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground touch:min-h-10"
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

      {table.status === 'AVAILABLE' && !canOpenTab ? (
        <p className="mx-auto max-w-md rounded-card border border-line bg-surface p-5 text-center text-sm text-muted-foreground">
          Mesa disponível. O seu perfil acompanha as comandas, mas não abre comandas.
        </p>
      ) : table.status === 'AVAILABLE' ? (
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
        <div className={`grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px] ${draft.length > 0 ? 'pb-20 lg:pb-0' : ''}`}>
          {/* Catalog */}
          {canEditTab && (
            <section className="flex min-h-0 flex-col gap-3">
              <Input placeholder="Buscar produto..." value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCategoryId(null)}
                  className={`rounded-full px-3 py-1.5 text-sm font-medium touch:py-2.5 ${
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
                    className={`rounded-full px-3 py-1.5 text-sm font-medium touch:py-2.5 ${
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
                  {visibleProducts.map((product) => {
                    // B7: 50 active units of this product on the tab and in the draft (the API refuses more).
                    const full = atUnitLimit(tabUnitsOfProduct(tab.items, draft, product.id));
                    return (
                      <button
                        key={product.id}
                        type="button"
                        onClick={() => handleAddProduct(product)}
                        disabled={full}
                        title={full ? MAX_UNITS_HINT : undefined}
                        className="flex flex-col items-start gap-1 rounded-card border border-line bg-surface p-3 text-left hover:border-accent hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className="font-medium">{product.name}</span>
                        <span className="text-sm font-bold">{formatCentsAsBRL(Math.round(product.price * 100))}</span>
                        {full && <span className="text-xs text-muted-foreground">{MAX_UNITS_HINT}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Current tab */}
          <section className="flex min-h-0 flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <h2 className="text-lg font-bold text-foreground">Comanda {tab.customerName ? `— ${tab.customerName}` : ''}</h2>

            {/* B9: the round being built, only on this device until it is sent. */}
            {draft.length > 0 && (
              <div className="space-y-2 rounded-ctl border border-warning/50 bg-warning/10 p-3">
                <p role="status" className="flex items-center gap-2 text-sm font-semibold text-warning">
                  <ChefHat className="h-4 w-4 shrink-0" aria-hidden />
                  {unsentLabel(draftUnits(draft))}
                </p>
                <ul className="space-y-2">
                  {draft.map((line) => (
                    <li key={line.key} className="rounded-ctl border border-line bg-surface p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-foreground">{line.name}</span>
                        <button
                          type="button"
                          onClick={() => updateDraft(setDraftQuantity(draft, line.key, 0))}
                          disabled={isSending}
                          className="inline-flex items-center text-xs text-danger underline touch:min-h-10 touch:px-2"
                        >
                          Remover
                        </button>
                      </div>
                      <input
                        type="text"
                        value={line.notes}
                        onChange={(e) => updateDraft(setDraftNotes(draft, line.key, e.target.value))}
                        placeholder="Observação (ex.: sem cebola)"
                        aria-label={`Observação de ${line.name}`}
                        maxLength={300}
                        disabled={isSending}
                        className="mt-1.5 w-full rounded-lg border border-line-strong bg-surface-2 px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent"
                      />
                      <div className="mt-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateDraft(setDraftQuantity(draft, line.key, line.quantity - 1))}
                            disabled={isSending}
                            aria-label={`Diminuir ${line.name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-sm font-bold text-foreground hover:bg-surface-hover active:scale-95 disabled:opacity-40 touch:h-11 touch:w-11"
                          >
                            −
                          </button>
                          <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
                          <button
                            type="button"
                            onClick={() => updateDraft(setDraftQuantity(draft, line.key, line.quantity + 1))}
                            disabled={isSending || atUnitLimit(tabUnitsOfProduct(tab.items, draft, line.productId))}
                            title={atUnitLimit(tabUnitsOfProduct(tab.items, draft, line.productId)) ? MAX_UNITS_HINT : undefined}
                            aria-label={`Aumentar ${line.name}`}
                            className="flex h-9 w-9 items-center justify-center rounded-full border border-line-strong text-sm font-bold text-foreground hover:bg-surface-hover active:scale-95 disabled:opacity-40 touch:h-11 touch:w-11"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-sm font-semibold">{formatCentsAsBRL(line.unitPriceCents * line.quantity)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button size="lg" fullWidth loading={isSending} onClick={handleSendRound} icon={<Send className="h-4 w-4" />}>
                  {isSending ? 'Enviando...' : 'Enviar para a cozinha'}
                </Button>
                <button
                  type="button"
                  onClick={() => updateDraft([])}
                  disabled={isSending}
                  className="block w-full text-center text-xs text-muted-foreground underline touch:min-h-10"
                >
                  Descartar rascunho
                </button>
              </div>
            )}

            {tab.items.length === 0 ? (
              <p className="flex-1 text-sm text-subtle">
                {canEditTab ? 'Nada enviado ainda. Toque nos produtos para montar a rodada.' : 'Nenhum item enviado.'}
              </p>
            ) : (
              <ul className="flex-1 space-y-2 overflow-y-auto" aria-label="Itens enviados">
                {tab.items.map((item) => {
                  const cancelled = item.status === 'CANCELLED';
                  const mayCancel = canEditTab && !cancelled && (!cancelNeedsManager(item.status) || canCancelStarted);
                  return (
                    <li key={item.id} className={`rounded-ctl border border-line bg-surface-2 p-2.5 ${cancelled ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className={`text-sm font-medium text-foreground ${cancelled ? 'line-through' : ''}`}>
                            <span className="mr-1 font-bold">{cancelled ? item.quantity : item.activeQuantity}×</span>
                            {item.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.roundNumber ? `Rodada ${item.roundNumber}` : 'Lançado antes das rodadas'}
                            {item.cancelledQuantity > 0 && !cancelled ? ` · ${item.cancelledQuantity} cancelado(s)` : ''}
                          </p>
                          {item.notes && <p className="mt-0.5 text-xs text-warning">{item.notes}</p>}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                            item.status === 'READY'
                              ? 'bg-success/15 text-success'
                              : item.status === 'PREPARING'
                                ? 'bg-primary/20 text-brand-muted'
                                : item.status === 'SENT'
                                  ? 'bg-accent/20 text-foreground'
                                  : 'bg-surface-hover text-muted-foreground'
                          }`}
                        >
                          {TAB_ITEM_STATUS_LABEL[item.status]}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2">
                          {canEditTab && canServe(item.status) && (
                            <Button size="sm" variant="secondary" loading={servingId === item.id} onClick={() => handleServe(item.id)}>
                              Entregue
                            </Button>
                          )}
                          {mayCancel && tab.status === 'OPEN' && (
                            <Button
                              size="sm"
                              variant="danger-ghost"
                              onClick={() => {
                                setCancelError(null);
                                setCancelTarget(item);
                              }}
                            >
                              Cancelar
                            </Button>
                          )}
                        </div>
                        <span className="text-sm font-semibold">{formatCentsAsBRL(item.subtotalCents)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex items-center justify-between border-t border-line pt-2 text-lg font-bold text-foreground">
              <span>Total ({tab.itemCount})</span>
              <span>{formatCentsAsBRL(tab.totalCents)}</span>
            </div>
            {draft.length > 0 && (
              <p className="-mt-2 text-right text-xs text-muted-foreground">
                + {formatCentsAsBRL(draftTotalCents(draft))} no rascunho (ainda não enviado)
              </p>
            )}
            {itemsNotDelivered(tab.items) > 0 && (
              <p className="text-xs text-muted-foreground">
                {itemsNotDelivered(tab.items) === 1
                  ? '1 item ainda não foi entregue na mesa.'
                  : `${itemsNotDelivered(tab.items)} itens ainda não foram entregues na mesa.`}
              </p>
            )}

            {!canCloseTab ? null : tab.itemCount === 0 && draft.length === 0 ? (
              // Nothing to charge (opened by mistake, or everything cancelled): free the table.
              <Button size="lg" variant="outline" fullWidth loading={isSubmitting} onClick={handleCloseEmpty}>
                Liberar mesa (sem cobrança)
              </Button>
            ) : !checkoutOpen ? (
              <>
                <Button size="lg" fullWidth disabled={tab.itemCount === 0 || draft.length > 0} onClick={openCheckout}>
                  Fechar conta
                </Button>
                {draft.length > 0 && (
                  <p className="text-xs text-warning">Envie ou descarte o rascunho antes de fechar a conta.</p>
                )}
              </>
            ) : (
              <CheckoutPanel
                itemCount={tab.itemCount}
                subtotalCents={tab.subtotalCents}
                totalCents={tab.totalCents}
                paymentMethod={paymentMethod}
                onPaymentMethod={setPaymentMethod}
                cashRegisterOpen={tab.branchCashRegisterOpen ?? false}
                options={TAB_PAYMENT_OPTIONS}
                isSubmitting={isSubmitting}
                onConfirm={handleCheckout}
                onCancel={cancelCheckout}
                customerSlot={
                  canLinkCustomer ? (
                    <div className="space-y-2">
                      <CustomerPicker
                        value={saleCustomer}
                        disabled={isSubmitting}
                        onChange={(picked) => {
                          setSaleCustomer(picked);
                          setCashbackInput('');
                          setCashbackMaxCents(0);
                        }}
                      />
                      {saleCustomer && (
                        <CashbackUseField
                          customerId={saleCustomer.id}
                          itemsAfterDiscountCents={tab.totalCents}
                          value={cashbackInput}
                          onChange={setCashbackInput}
                          onMaxChange={setCashbackMaxCents}
                          disabled={isSubmitting}
                        />
                      )}
                    </div>
                  ) : null
                }
              />
            )}
          </section>
          {/* Phone: the catalog is long and the draft sits below it, so the send stays in reach. */}
          {draft.length > 0 && (
            <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-line bg-surface px-4 py-3 shadow-lg lg:hidden">
              <span className="flex-1 text-sm font-semibold text-warning">{unsentLabel(draftUnits(draft))}</span>
              <Button loading={isSending} onClick={handleSendRound} icon={<Send className="h-4 w-4" />}>
                {isSending ? 'Enviando...' : 'Enviar para a cozinha'}
              </Button>
            </div>
          )}
        </div>
      )}
      <TabItemCancelDialog
        item={cancelTarget}
        error={cancelError}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelItem}
      />
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
  options,
  isSubmitting,
  onConfirm,
  onCancel,
  customerSlot,
}: {
  itemCount: number;
  subtotalCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  onPaymentMethod: (method: PaymentMethod) => void;
  cashRegisterOpen: boolean;
  // Money received now (cash, PIX, card): fiado is not offered any more.
  options: { value: PaymentMethod; label: string }[];
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  customerSlot?: React.ReactNode;
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

      {customerSlot && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Cliente (opcional)</p>
          {customerSlot}
        </div>
      )}

      <fieldset className="space-y-1" disabled={isSubmitting}>
        <legend className="mb-1 text-xs text-muted-foreground">Forma de pagamento</legend>
        {options.map((option) => (
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
