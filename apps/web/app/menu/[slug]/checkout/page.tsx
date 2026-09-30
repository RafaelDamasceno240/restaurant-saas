'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCart } from '@/lib/cart-context';
import { createIdempotencyKey } from '@/lib/idempotency-key';
import { formatCentsAsBRL } from '@/lib/money';
import { getPublicMenu, PublicMenuDelivery } from '@/lib/public-menu-api';
import { ApiError } from '@/lib/api-client';
import {
  createOrder,
  CreateOrderInput,
  FulfillmentType,
  PaymentMethod,
} from '@/lib/checkout-api';

interface PageProps {
  params: { slug: string };
}

const emptyAddress = {
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
};

export default function CheckoutPage({ params }: PageProps) {
  const router = useRouter();
  const { restaurantSlug, restaurantName, items, subtotalCents, clearCart } = useCart();
  const belongsToThisRestaurant = restaurantSlug === params.slug;
  const visibleItems = belongsToThisRestaurant ? items : [];

  const orderKeyRef = useRef<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [fulfillmentType, setFulfillmentType] = useState<FulfillmentType>('PICKUP');
  const [address, setAddress] = useState(emptyAddress);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [notes, setNotes] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Delivery terms are informational here; the server is the source of truth and
  // recomputes the fee / enforces the minimum on order creation.
  const [terms, setTerms] = useState<PublicMenuDelivery | null>(null);

  useEffect(() => {
    let active = true;
    getPublicMenu(params.slug)
      .then((menu) => {
        // `?? null`: an older API without the field must not break the checkout.
        if (active) setTerms(menu.delivery ?? null);
      })
      .catch(() => {
        if (active) setTerms(null);
      });
    return () => {
      active = false;
    };
  }, [params.slug]);

  const deliveryUnavailable = terms !== null && !terms.enabled;
  const feeCents = fulfillmentType === 'DELIVERY' && terms?.enabled ? Math.round(terms.fee * 100) : 0;
  const minOrderCents = terms?.enabled ? Math.round(terms.minOrder * 100) : 0;
  const belowMinimum = fulfillmentType === 'DELIVERY' && minOrderCents > subtotalCents;

  if (visibleItems.length === 0) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-2xl" aria-hidden>
          🛒
        </p>
        <p className="font-medium">Seu carrinho está vazio</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Adicione produtos ao cardápio antes de continuar para o checkout.
        </p>
        <Link
          href={`/menu/${params.slug}`}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Voltar ao cardápio
        </Link>
      </main>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    // Frontend validation only smooths the experience — it never replaces
    // the backend's own validation (see apps/api/.../create-order.dto.ts).
    if (!name.trim() || !phone.trim()) {
      setError('Preencha nome e telefone.');
      return;
    }
    if (fulfillmentType === 'DELIVERY') {
      const required: (keyof typeof address)[] = [
        'street',
        'number',
        'neighborhood',
        'city',
        'state',
        'zipCode',
      ];
      if (required.some((field) => !address[field].trim())) {
        setError('Preencha o endereço completo para entrega.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      orderKeyRef.current ??= createIdempotencyKey();
      // CRITICAL: only productId + quantity travel to the backend. No price,
      // no name, no subtotal, no total — those are recalculated server-side
      // from the database, never trusted from this cart.
      const input: CreateOrderInput = {
        restaurantSlug: params.slug,
        items: visibleItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        customer: { name: name.trim(), phone: phone.trim() },
        fulfillmentType,
        paymentMethod,
        notes: notes.trim() || undefined,
        idempotencyKey: orderKeyRef.current,
        ...(fulfillmentType === 'DELIVERY'
          ? { address, deliveryNotes: deliveryNotes.trim() || undefined }
          : {}),
      };
      const order = await createOrder(input);
      clearCart();
      router.push(`/menu/${params.slug}/pedido/${order.id}`);
    } catch (err) {
      if (err instanceof ApiError) orderKeyRef.current = null;
      setError(
        err instanceof ApiError
          ? err.message
          : 'Não foi possível enviar o pedido. Tente novamente.',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 bg-background px-4 pb-24 pt-6">
      <div>
        <Link href={`/menu/${params.slug}/carrinho`} className="text-sm text-muted-foreground underline">
          ← Voltar ao carrinho
        </Link>
        <h1 className="mt-2 text-lg font-semibold">
          Checkout{belongsToThisRestaurant && restaurantName ? ` · ${restaurantName}` : ''}
        </h1>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Resumo do pedido</h2>
        <ul className="divide-y divide-line">
          {visibleItems.map((item) => (
            <li key={item.productId} className="flex items-center justify-between py-2 text-sm">
              <span>
                {item.quantity}× {item.name}
              </span>
              <span className="font-medium">
                {formatCentsAsBRL(item.priceCents * item.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2 font-semibold">
          <span>Subtotal</span>
          <span>{formatCentsAsBRL(subtotalCents)}</span>
        </div>
        {fulfillmentType === 'DELIVERY' && terms?.enabled && (
          <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
            <span>Taxa de entrega</span>
            <span>{feeCents > 0 ? formatCentsAsBRL(feeCents) : 'Grátis'}</span>
          </div>
        )}
      </section>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Seus dados</h2>
          <Input placeholder="Nome" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            placeholder="Telefone (com DDD)"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Entrega ou retirada</h2>
          <div className="flex gap-3">
            <RadioPill
              label="Retirada"
              checked={fulfillmentType === 'PICKUP'}
              onClick={() => setFulfillmentType('PICKUP')}
            />
            <RadioPill
              label={deliveryUnavailable ? 'Entrega indisponível' : 'Entrega'}
              checked={fulfillmentType === 'DELIVERY'}
              onClick={() => {
                if (!deliveryUnavailable) setFulfillmentType('DELIVERY');
              }}
            />
          </div>
          {deliveryUnavailable && (
            <p className="text-xs text-muted-foreground">
              Este restaurante não está aceitando entregas agora. Você pode escolher retirada.
            </p>
          )}
          {fulfillmentType === 'DELIVERY' && terms?.enabled && (
            <p className="text-xs text-muted-foreground">
              Taxa de entrega: {feeCents > 0 ? formatCentsAsBRL(feeCents) : 'grátis'}
              {minOrderCents > 0 ? ` · pedido mínimo ${formatCentsAsBRL(minOrderCents)} (sem a taxa)` : ''}
            </p>
          )}
          {belowMinimum && (
            <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
              Faltam {formatCentsAsBRL(minOrderCents - subtotalCents)} em itens para atingir o pedido mínimo de entrega.
            </p>
          )}

          {fulfillmentType === 'DELIVERY' && (
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Input
                className="col-span-2"
                placeholder="Rua"
                required
                value={address.street}
                onChange={(e) => setAddress({ ...address, street: e.target.value })}
              />
              <Input
                placeholder="Número"
                required
                value={address.number}
                onChange={(e) => setAddress({ ...address, number: e.target.value })}
              />
              <Input
                placeholder="Complemento (opcional)"
                value={address.complement}
                onChange={(e) => setAddress({ ...address, complement: e.target.value })}
              />
              <Input
                placeholder="Bairro"
                required
                value={address.neighborhood}
                onChange={(e) => setAddress({ ...address, neighborhood: e.target.value })}
              />
              <Input
                placeholder="Cidade"
                required
                value={address.city}
                onChange={(e) => setAddress({ ...address, city: e.target.value })}
              />
              <Input
                placeholder="UF"
                required
                maxLength={2}
                value={address.state}
                onChange={(e) => setAddress({ ...address, state: e.target.value.toUpperCase() })}
              />
              <Input
                placeholder="CEP"
                required
                value={address.zipCode}
                onChange={(e) => setAddress({ ...address, zipCode: e.target.value })}
              />
              <Textarea
                className="col-span-2"
                placeholder="Instruções para a entrega (opcional): portão azul, interfone 204..."
                aria-label="Instruções para a entrega"
                maxLength={300}
                rows={2}
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
              />
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Pagamento</h2>
          <div className="flex flex-wrap gap-3">
            <RadioPill
              label="Dinheiro"
              checked={paymentMethod === 'CASH'}
              onClick={() => setPaymentMethod('CASH')}
            />
            <RadioPill
              label="Pix"
              checked={paymentMethod === 'PIX'}
              onClick={() => setPaymentMethod('PIX')}
            />
            <RadioPill
              label="Cartão"
              checked={paymentMethod === 'CARD'}
              onClick={() => setPaymentMethod('CARD')}
            />
          </div>
          <p className="text-xs text-subtle">
            Nesta fase o pagamento é apenas uma preferência registrada no pedido — nenhuma
            cobrança é processada.
          </p>
        </section>

        <section className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <h2 className="text-sm font-medium text-muted-foreground">Observações (opcional)</h2>
          <Textarea
            placeholder="Ex.: sem cebola, troco para R$ 50..."
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </section>

        {error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-4">
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-lg font-semibold">{formatCentsAsBRL(subtotalCents + feeCents)}</p>
            </div>
            <Button type="submit" className="w-auto px-6" disabled={isSubmitting}>
              {isSubmitting ? 'Enviando...' : 'Confirmar pedido'}
            </Button>
          </div>
        </div>
      </form>
    </main>
  );
}

function RadioPill({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={checked}
      className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-line-strong bg-surface text-muted-foreground'
      }`}
    >
      {label}
    </button>
  );
}
