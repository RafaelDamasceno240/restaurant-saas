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
  Pencil,
  Plus,
  QrCode,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Product, categoriesApi, optionGroupsApi, productsApi } from '@/lib/cardapio-api';
import { createIdempotencyKey } from '@/lib/idempotency-key';
import { formatCentsAsBRL } from '@/lib/money';
import { MAX_UNITS_HINT, atUnitLimit, unitsOfProduct } from '@/lib/cart-logic';
import { createPosOrder, previewPosCoupon, quotePosItems } from '@/lib/pos-api';
import { needsPersonalization, optionsSummary, productSaleGroups, selectionFromOptions, toApiLine } from '@/lib/staff-addons';
import { useServerQuote } from '@/lib/use-server-quote';
import { ProductOptionsDialog, ProductOptionsInitial } from '@/components/sales/ProductOptionsDialog';
import { CouponPreview } from '@/lib/coupons-api';
import { couponApplyMessage, couponPreviewKey, totalAfterCouponCents } from '@/lib/coupons-logic';
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
  replaceLine,
  roomFor,
} from '@/lib/pos-logic';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Input, SearchInput } from '@/components/ds/Input';
import { Tooltip } from '@/components/ds/Tooltip';
import { CustomerPicker, PickedCustomer } from '@/components/customers/CustomerPicker';
import { CashbackUseField } from '@/components/cashback/CashbackUseField';
import { parseCashbackToUse, validateCashbackToUse } from '@/lib/cashback-logic';
import { receivableErrorMessage } from '@/lib/receivables-logic';
import clsx from 'clsx';

const formatBRL = formatCentsAsBRL;

// Money received now. Fiado (sell now, charge later) is not offered: the owner turned it off
// (remocao-fiado) and the API refuses it whatever a screen sends.
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
  const { accessToken, user } = useAuth();
  const { branchId } = useActiveBranch();
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const saleKeyRef = useRef<string | null>(null);
  // Synchronous guard for the coupon button: two clicks in one tick start only one preview.
  const couponBusy = useRef(false);

  // PDV state is deliberately its own — NOT the public CartContext, NOT its
  // localStorage key. A sale here always starts empty and never persists
  // across a reload; see docs/PROJECT_STATUS.md "Fatia 07".
  const [cart, setCart] = useState<PosCartItem[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  // A customer of the registry (optional). Only the id is sent; with one picked, the name and
  // phone of the sale come from the registry on the server.
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  // Cashback of the picked customer to spend on this sale: what the cashier typed, and the
  // most this basket may use (reported by CashbackUseField). Only the amount is sent; the API
  // checks it against the real balance when the sale is created.
  const [cashbackInput, setCashbackInput] = useState('');
  const [cashbackMaxCents, setCashbackMaxCents] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<AdminOrderDetail | null>(null);
  const [cartOpen, setCartOpen] = useState(false); // small screens: cart is a full-screen sheet
  // Coupon: only the CODE is ever sent with the sale. The preview is a read-only convenience that
  // is valid for the exact basket/branch/code it was asked for; the sale itself re-validates and
  // recalculates everything on the server, whatever this screen shows.
  const [couponInput, setCouponInput] = useState('');
  const [couponPreview, setCouponPreview] = useState<{ key: string; preview: CouponPreview } | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);

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

  // Add-on groups of the menu (products.read), joined to each product by its optionGroupIds.
  const optionGroupsQuery = useQuery({
    queryKey: ['pdv-option-groups'],
    queryFn: () => optionGroupsApi.list(accessToken as string),
    enabled: !!accessToken,
  });

  // The product being personalized (a new line, or `editKey` = the cart line being edited).
  const [personalizing, setPersonalizing] = useState<{
    product: Product;
    editKey: string | null;
    initial: ProductOptionsInitial | null;
  } | null>(null);
  const personalizingGroups = personalizing ? productSaleGroups(personalizing.product, optionGroupsQuery.data) : [];

  const products = productsQuery.data ?? [];
  const visibleProducts = filterPosProducts(products, search, categoryId);
  const personalizableIds = new Set(products.filter((p) => p.optionGroupIds.length > 0).map((p) => p.id));
  const totalQuantity = getTotalQuantity(cart);

  // What goes to the API for each line (ids, quantities, note - never a price), and what the
  // server says these lines cost right now. The screen shows the server's numbers whenever they
  // match the cart, and its own estimate (marked) while it asks.
  const apiLines = cart.map(toApiLine);
  const serverQuote = useServerQuote(apiLines, accessToken ? (lines) => quotePosItems(accessToken, lines) : null);
  const estimatedSubtotalCents = getSubtotalCents(cart);
  const subtotalCents = serverQuote.quote?.subtotalCents ?? estimatedSubtotalCents;
  const lineSubtotalCents = (index: number) =>
    serverQuote.quote?.items[index]?.subtotalCents ?? cart[index].priceCents * cart[index].quantity;
  // Applying coupons needs coupons.apply: OWNER/ADMIN/MANAGER/CASHIER (the API enforces it).
  const canApplyCoupon = (user?.roles ?? []).some((role) => ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'].includes(role));
  // Reading and registering customers needs customers.read/create: the same four roles.
  const canPickCustomer = canApplyCoupon;
  const couponCode = couponInput.trim();
  // A coupon limited per customer is valid or not depending on WHO buys: the preview belongs
  // to the customer it was asked for, too.
  const previewKeyFor = (branch: string, code: string) => `${couponPreviewKey(branch, code, apiLines)}|${customer?.id ?? ''}`;
  const currentPreviewKey = branchId && couponCode ? previewKeyFor(branchId, couponCode) : null;
  const appliedCoupon = couponPreview && couponPreview.key === currentPreviewKey ? couponPreview.preview : null;
  const discountCents = appliedCoupon?.discountCents ?? 0;
  const itemsAfterDiscountCents = totalAfterCouponCents(subtotalCents, discountCents);
  // Shown and sent only while it is a valid amount for this basket; otherwise nothing is used.
  const cashbackProblem = customer ? validateCashbackToUse(cashbackInput, cashbackMaxCents) : null;
  const cashbackCents = customer && !cashbackProblem ? (parseCashbackToUse(cashbackInput) ?? 0) : 0;
  const totalCents = itemsAfterDiscountCents - cashbackCents;
  const paymentOptions = PAYMENT_OPTIONS;

  // A product with add-ons opens its personalization; one without is added at once (the fast
  // counter flow: tap, tap, tap). While the groups are still loading, the dialog waits for them.
  function addProduct(product: Product) {
    const hasGroups = optionGroupsQuery.data
      ? needsPersonalization(productSaleGroups(product, optionGroupsQuery.data))
      : product.optionGroupIds.length > 0;
    if (hasGroups) {
      setPersonalizing({ product, editKey: null, initial: null });
      return;
    }
    setCart((prev) =>
      addToCart(prev, {
        productId: product.id,
        name: product.name,
        priceCents: Math.round(product.price * 100),
      }),
    );
  }

  // Opens a cart line again with its add-ons, note and quantity, to change any of them.
  function editLine(key: string) {
    const line = cart.find((item) => item.key === key);
    const product = products.find((p) => p.id === line?.productId);
    if (!line || !product) return;
    const { selection, dropped } = selectionFromOptions(productSaleGroups(product, optionGroupsQuery.data), line.options);
    setPersonalizing({
      product,
      editKey: key,
      initial: { selection, notes: line.notes ?? '', quantity: line.quantity, droppedCount: dropped.length },
    });
  }

  async function applyCoupon() {
    if (!couponCode || !branchId || cart.length === 0 || couponBusy.current) return;
    couponBusy.current = true;
    setCouponLoading(true);
    setCouponMessage(null);
    const key = previewKeyFor(branchId, couponCode);
    try {
      const preview = await previewPosCoupon(accessToken as string, {
        branchId,
        items: apiLines,
        code: couponCode,
        ...(customer ? { customerId: customer.id } : {}),
      });
      setCouponPreview({ key, preview });
    } catch (err) {
      setCouponPreview(null);
      setCouponMessage(
        err instanceof ApiError ? couponApplyMessage(err.code, err.message) : 'Não foi possível validar o cupom.',
      );
    } finally {
      couponBusy.current = false;
      setCouponLoading(false);
    }
  }

  function clearCoupon() {
    setCouponInput('');
    setCouponPreview(null);
    setCouponMessage(null);
  }

  function resetSale() {
    saleKeyRef.current = null;
    clearCoupon();
    setCart([]);
    setSearch('');
    setCategoryId(null);
    setCustomerName('');
    setCustomerPhone('');
    setCustomer(null);
    setCashbackInput('');
    setCashbackMaxCents(0);
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
    if (cashbackProblem) {
      setError(cashbackProblem);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      saleKeyRef.current ??= createIdempotencyKey();
      const order = await createPosOrder(accessToken as string, {
        branchId,
        items: apiLines,
        ...(customer
          ? { customerId: customer.id }
          : { customerName: customerName.trim() || undefined, customerPhone: customerPhone.trim() || undefined }),
        paymentMethod,
        couponCode: couponCode || undefined,
        ...(cashbackCents > 0 ? { cashbackToUseCents: cashbackCents } : {}),
        idempotencyKey: saleKeyRef.current,
      });
      saleKeyRef.current = null;
      setConfirmation(order);
      // A CASH sale adds a SALE movement to the open cash session.
      queryClient.invalidateQueries({ queryKey: ['cash-current'] });
    } catch (err) {
      if (err instanceof ApiError) saleKeyRef.current = null;
      // Covers CASH_REGISTER_NOT_OPEN; other codes keep the API message.
      setError(err instanceof ApiError ? receivableErrorMessage(err.code, err.message) : 'Não foi possível finalizar a venda.');
    } finally {
      setIsSubmitting(false);
    }
  }

  // Keyboard flow for a fast counter: "/" jumps to search, F9 finalizes.
  // Refs keep the listener stable while still seeing the latest handler.
  const finalizeRef = useRef(handleFinalize);
  finalizeRef.current = handleFinalize;
  const canFinalizeRef = useRef(false);
  canFinalizeRef.current = !isSubmitting && cart.length > 0 && !confirmation && !personalizing;
  const dialogOpenRef = useRef(false);
  dialogOpenRef.current = personalizing !== null;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (dialogOpenRef.current) return;
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
          {confirmation.discount > 0 && (
            <p className="text-sm text-success">
              Cupom {confirmation.couponCode}: desconto de {formatBRL(Math.round(confirmation.discount * 100))}
            </p>
          )}
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
            {cart.map((item, index) => {
              const quoted = serverQuote.quote?.items[index];
              const productAtLimit = atUnitLimit(unitsOfProduct(cart, item.productId));
              // Any line opens again: add-ons, the note for the kitchen and the quantity (a product
              // without add-ons only gets the note there).
              const editable = products.some((p) => p.id === item.productId);
              return (
              <li key={item.key} className="animate-fade-in px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground">{item.name}</span>
                    {item.options.length > 0 && (
                      <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground" aria-label={`Adicionais de ${item.name}`}>
                        {item.options.map((option) => (
                          <li key={option.optionId}>
                            + {option.quantity > 1 ? `${option.quantity}× ` : ''}
                            {option.name}
                            {option.priceCents > 0 && (
                              <span className="text-subtle"> ({formatBRL(option.priceCents * option.quantity)})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.notes && <p className="mt-0.5 text-xs italic text-warning">Obs.: {item.notes}</p>}
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                    {formatBRL(lineSubtotalCents(index))}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-1 rounded-ctl border border-line bg-surface-2 p-0.5">
                    <button
                      type="button"
                      onClick={() => setCart((prev) => decrementItem(prev, item.key))}
                      aria-label={`Diminuir ${item.name}`}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-surface-hover active:scale-95 touch:h-11 touch:w-11"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="w-7 text-center text-sm font-semibold text-foreground">{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setCart((prev) => incrementItem(prev, item.key))}
                      disabled={productAtLimit}
                      title={productAtLimit ? MAX_UNITS_HINT : undefined}
                      aria-label={`Aumentar ${item.name}`}
                      className="flex h-9 w-9 items-center justify-center rounded-md text-foreground transition-colors hover:bg-surface-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 touch:h-11 touch:w-11"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-1 text-right text-xs leading-tight text-subtle">
                      {formatBRL(quoted?.unitPriceCents ?? item.priceCents)} un.
                      {(quoted?.extrasCents ?? 0) > 0 && (
                        <span className="block">
                          {formatBRL(quoted!.basePriceCents)} + {formatBRL(quoted!.extrasCents)}
                        </span>
                      )}
                    </span>
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${item.name}${item.options.length ? ` (${optionsSummary(item.options)})` : ''}`}
                        title={item.options.length || personalizableIds.has(item.productId) ? 'Editar adicionais e observação' : 'Adicionar observação'}
                        onClick={() => editLine(item.key)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="danger-ghost"
                      size="icon"
                      aria-label={`Remover ${item.name}${item.options.length ? ` (${optionsSummary(item.options)})` : ''}`}
                      onClick={() => setCart((prev) => removeItem(prev, item.key))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {productAtLimit && <p className="mt-1 text-xs text-subtle">{MAX_UNITS_HINT}</p>}
              </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3 border-t border-line p-4">
        {canPickCustomer && (
          <CustomerPicker
            value={customer}
            disabled={isSubmitting}
            onChange={(picked) => {
              setCustomer(picked);
              // A message about the previous choice (no customer, no limit) no longer applies.
              setError(null);
              // Another customer, another balance: never carry an amount over.
              setCashbackInput('');
              setCashbackMaxCents(0);
            }}
          />
        )}
        {canPickCustomer && customer && cart.length > 0 && (
          <CashbackUseField
            customerId={customer.id}
            itemsAfterDiscountCents={itemsAfterDiscountCents}
            value={cashbackInput}
            onChange={setCashbackInput}
            onMaxChange={setCashbackMaxCents}
            disabled={isSubmitting}
          />
        )}
        {!customer && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder={canPickCustomer ? 'Ou só o nome (opcional)' : 'Cliente (opcional)'}
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
        )}

        {canApplyCoupon && (
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Input
                placeholder="Cupom (opcional)"
                aria-label="Cupom"
                value={couponInput}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="characters"
                className="font-mono uppercase"
                onChange={(e) => {
                  setCouponInput(e.target.value);
                  setCouponMessage(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void applyCoupon();
                  }
                }}
              />
              <Button
                variant="outline"
                onClick={() => void applyCoupon()}
                loading={couponLoading}
                disabled={couponLoading || !couponCode || cart.length === 0}
              >
                Aplicar
              </Button>
              {couponCode && (
                <Button variant="ghost" aria-label="Remover cupom" onClick={clearCoupon} disabled={couponLoading}>
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
            {couponMessage && (
              <p role="alert" className="text-xs text-danger">
                {couponMessage}
              </p>
            )}
            {appliedCoupon && (
              <p role="status" className="text-xs text-success">
                Cupom {appliedCoupon.code} aplicado: desconto de {formatBRL(appliedCoupon.discountCents)}
              </p>
            )}
            {couponCode && !appliedCoupon && !couponMessage && (
              <p className="text-xs text-muted-foreground">
                O cupom é conferido pelo servidor ao finalizar. Toque em Aplicar para ver o desconto desta venda.
              </p>
            )}
          </div>
        )}

        <div
          role="radiogroup"
          aria-label="Forma de pagamento"
          className={clsx('grid gap-2', paymentOptions.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}
        >
          {paymentOptions.map((option) => {
            const Icon = option.icon;
            const selected = paymentMethod === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  setPaymentMethod(option.value);
                  setError(null);
                }}
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


        {(appliedCoupon || cashbackCents > 0) && (
          <div className="space-y-0.5 text-sm text-muted-foreground">
            <div className="flex items-baseline justify-between">
              <span>Subtotal</span>
              <span className="tabular-nums">{formatBRL(subtotalCents)}</span>
            </div>
            {appliedCoupon && (
              <div className="flex items-baseline justify-between text-success">
                <span>Desconto ({appliedCoupon.code})</span>
                <span className="tabular-nums">− {formatBRL(discountCents)}</span>
              </div>
            )}
            {cashbackCents > 0 && (
              <div className="flex items-baseline justify-between text-success">
                <span>Cashback</span>
                <span className="tabular-nums">− {formatBRL(cashbackCents)}</span>
              </div>
            )}
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-2xl font-bold tracking-tight text-foreground">{formatBRL(totalCents)}</span>
        </div>
        {cart.length > 0 && (
          <p className="-mt-2 text-right text-2xs text-subtle" role="status" aria-live="polite">
            {serverQuote.quote ? 'Valores conferidos pelo sistema' : serverQuote.pending ? 'Conferindo valores...' : 'Valor estimado; o sistema confere ao finalizar'}
          </p>
        )}
        {serverQuote.error && <Alert>{serverQuote.error}</Alert>}

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
            const base = 'whitespace-nowrap rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors touch:py-2.5';
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
                const inCart = unitsOfProduct(cart, product.id);
                const personalizable = product.optionGroupIds.length > 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addProduct(product)}
                    disabled={atUnitLimit(inCart)}
                    title={atUnitLimit(inCart) ? MAX_UNITS_HINT : undefined}
                    className="group relative flex flex-col overflow-hidden rounded-card border border-line bg-surface text-left transition-all hover:border-line-strong hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="relative flex aspect-[4/3] w-full items-center justify-center bg-surface-2">
                      {product.photoUrl ? (
                        // photoUrl: the uploaded/imported photo, else the pasted link (what the public
                        // menu shows). imageUrl alone is empty for imported products.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.photoUrl} alt="" className="h-full w-full object-cover" />
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
                        {personalizable ? 'Personalizar' : 'Adicionar'}
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

      <ProductOptionsDialog
        open={personalizing !== null}
        product={personalizing?.product ?? null}
        groups={personalizingGroups}
        loading={optionGroupsQuery.isLoading}
        initial={personalizing?.initial}
        // The line being edited gives its own units back to the 50-per-product allowance.
        maxQuantity={
          personalizing
            ? roomFor(
                cart.filter((item) => item.key !== personalizing.editKey),
                personalizing.product.id,
              )
            : 0
        }
        noteMax={140}
        confirmLabel={personalizing?.editKey ? 'Salvar alterações' : 'Adicionar à venda'}
        onClose={() => setPersonalizing(null)}
        onConfirm={(line) => {
          const input = { productId: line.productId, name: line.name, priceCents: line.unitPriceCents, options: line.options, notes: line.notes, quantity: line.quantity };
          setCart((prev) => (personalizing?.editKey ? replaceLine(prev, personalizing.editKey, input) : addToCart(prev, input)));
          setPersonalizing(null);
          searchRef.current?.focus();
        }}
      />

      {/* Small screens: sticky bar that opens the cart sheet. */}
      {!cartOpen && (
        <div className="shrink-0 border-t border-line bg-surface p-3 lg:hidden">
          <Button size="lg" fullWidth onClick={() => setCartOpen(true)} icon={<ShoppingCart className="h-5 w-5" />}>
            Ver venda · {totalQuantity} · {formatBRL(totalCents)}
          </Button>
        </div>
      )}
    </div>
  );
}
