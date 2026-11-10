'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import { ArrowLeft, Check, Minus, Plus, Search } from 'lucide-react';
import type {
  PublicMenuOptionGroup,
  PublicMenuProduct,
  PublicRestaurant,
} from '@/lib/public-menu-api';
import { useCart } from '@/lib/cart-context';
import { MAX_UNITS_PER_PRODUCT, unitsOfProduct } from '@/lib/cart-logic';
import { formatCentsAsBRL, toCents } from '@/lib/money';
import {
  Selection,
  canIncrement,
  chosenOptions,
  decrement,
  describeOpening,
  firstMissingGroup,
  groupRuleText,
  groupUnits,
  increment,
  isSingleChoice,
  unitPriceCents,
} from '@/lib/menu-display';
import { ProductImage } from './ProductImage';
import { ProductPrice } from './ProductPrice';
import { BADGE_LABEL } from './ProductRow';

const NOTE_MAX = 140;
// Long lists of add-ons get a filter, like the rest of the menu.
const FILTER_FROM = 9;

// The product page: photo, description, add-on groups (required ones checked before adding),
// a note for the kitchen, how many units, and the price of all of it. Only ids and quantities go
// to the cart's order later; the server prices everything again.
export function ProductDetail({
  product,
  restaurant,
  slug,
}: {
  product: PublicMenuProduct;
  restaurant: PublicRestaurant;
  slug: string;
}) {
  const router = useRouter();
  const { addItem, items, restaurantSlug } = useCart();
  const groups = useMemo(() => product.optionGroups ?? [], [product.optionGroups]);
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  const [closedText, setClosedText] = useState<string | null>(
    restaurant.openNow === false ? 'Fechado agora' : null,
  );
  useEffect(() => {
    const status = describeOpening(restaurant.openingHours, new Date(), restaurant.timeZone);
    setClosedText(
      status.open === false ? status.text : restaurant.openNow === false ? 'Fechado agora' : null,
    );
  }, [restaurant.openingHours, restaurant.timeZone, restaurant.openNow]);

  const inCart = restaurantSlug === slug ? unitsOfProduct(items, product.id) : 0;
  const room = Math.max(0, MAX_UNITS_PER_PRODUCT - inCart);
  const unit = unitPriceCents(product, selection);
  const missing = firstMissingGroup(groups, selection);
  const soldOut = !!product.soldOut;
  const blocked = soldOut || closedText !== null || room === 0;

  function handleAdd() {
    if (blocked) return;
    if (missing) {
      setHighlight(missing.id);
      groupRefs.current[missing.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    addItem(
      {
        productId: product.id,
        name: product.name,
        priceCents: unit,
        imageUrl: product.imageUrl,
        options: chosenOptions(groups, selection),
        notes: notes.trim() || null,
        quantity: Math.min(quantity, room),
      },
      { slug, name: restaurant.name },
    );
    router.push(`/menu/${slug}`);
  }

  return (
    <main className="min-h-screen pb-32">
      <div className="relative mx-auto max-w-2xl">
        <Link
          href={`/menu/${slug}`}
          aria-label="Voltar ao cardápio"
          className="absolute left-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow backdrop-blur hover:bg-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <ProductImage
          src={product.imageUrl}
          alt={product.name}
          eager
          className="aspect-[4/3] max-h-[26rem] w-full sm:rounded-b-3xl"
        />

        <div className="bg-surface px-4 pb-4 pt-5 sm:mt-4 sm:rounded-3xl sm:border sm:border-line">
          {(product.badges?.length ?? 0) > 0 && (
            <div className="mb-2 flex flex-wrap gap-1">
              {product.badges!.map((b) => (
                <span
                  key={b}
                  className="rounded-full bg-success/10 px-2 py-0.5 text-2xs font-medium text-success"
                >
                  {BADGE_LABEL[b]}
                </span>
              ))}
            </div>
          )}
          <h1 className="text-xl font-bold leading-tight text-foreground">{product.name}</h1>
          {product.description && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}
          <ProductPrice product={product} className="mt-3 text-base" />
          {soldOut && (
            <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
              Produto esgotado no momento.
            </p>
          )}
        </div>

        {groups.map((group) => (
          <OptionGroupSection
            key={group.id}
            group={group}
            selection={selection}
            highlighted={highlight === group.id}
            refCallback={(el) => {
              groupRefs.current[group.id] = el;
            }}
            onChange={(next) => {
              setSelection(next);
              if (highlight === group.id && groupUnits(group, next) >= group.minSelect)
                setHighlight(null);
            }}
          />
        ))}

        <section className="mt-2 bg-surface px-4 py-4 sm:mt-4 sm:rounded-3xl sm:border sm:border-line">
          <label
            htmlFor="observacao"
            className="flex items-baseline justify-between text-sm font-semibold text-foreground"
          >
            Alguma observação?
            <span className="text-2xs font-normal text-subtle">
              {notes.length}/{NOTE_MAX}
            </span>
          </label>
          <textarea
            id="observacao"
            value={notes}
            maxLength={NOTE_MAX}
            rows={2}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: sem cebola, ponto da carne..."
            className="mt-2 w-full resize-none rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-primary focus:bg-surface"
          />
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          {blocked ? (
            <p className="flex-1 py-2 text-center text-sm font-semibold text-muted-foreground">
              {soldOut
                ? 'Produto esgotado'
                : closedText
                  ? `Estamos fechados · ${closedText.replace(/^Fechado · /, '')}`
                  : `Limite de ${MAX_UNITS_PER_PRODUCT} unidades no carrinho`}
            </p>
          ) : (
            <>
              <Stepper
                value={quantity}
                min={1}
                max={room}
                label={product.name}
                onChange={setQuantity}
              />
              <button
                type="button"
                onClick={handleAdd}
                className={clsx(
                  'flex flex-1 items-center justify-between gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold transition',
                  missing
                    ? 'bg-primary/60 text-primary-foreground'
                    : 'bg-primary text-primary-foreground hover:bg-primary-hover',
                )}
              >
                <span>{missing ? 'Escolha as opções' : 'Adicionar'}</span>
                <span className="tabular-nums">{formatCentsAsBRL(unit * quantity)}</span>
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function OptionGroupSection({
  group,
  selection,
  onChange,
  highlighted,
  refCallback,
}: {
  group: PublicMenuOptionGroup;
  selection: Selection;
  onChange: (next: Selection) => void;
  highlighted: boolean;
  refCallback: (el: HTMLElement | null) => void;
}) {
  const [filter, setFilter] = useState('');
  const units = groupUnits(group, selection);
  const required = group.minSelect > 0;
  const satisfied = units >= group.minSelect;
  const single = isSingleChoice(group);
  const q = filter.trim().toLowerCase();
  const options = q
    ? group.options.filter((o) => `${o.name} ${o.description ?? ''}`.toLowerCase().includes(q))
    : group.options;

  return (
    <section
      ref={refCallback}
      aria-labelledby={`grupo-${group.id}`}
      className={clsx(
        'mt-2 bg-surface px-4 py-4 transition sm:mt-4 sm:rounded-3xl sm:border',
        highlighted ? 'ring-2 ring-inset ring-danger sm:border-danger' : 'sm:border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`grupo-${group.id}`} className="text-base font-bold text-foreground">
            {group.name}
          </h2>
          <p className="text-xs text-muted-foreground">{groupRuleText(group)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!single && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs font-semibold tabular-nums text-muted-foreground">
              {units}/{group.maxSelect}
            </span>
          )}
          {required && (
            <span
              className={clsx(
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
                satisfied ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
              )}
            >
              {satisfied && <Check className="h-3 w-3" aria-hidden />}
              Obrigatório
            </span>
          )}
        </div>
      </div>

      {group.options.length >= FILTER_FROM && (
        <label className="relative mt-3 block">
          <span className="sr-only">Buscar em {group.name}</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Buscar opção"
            className="h-9 w-full rounded-full border border-line bg-surface-2 pl-9 pr-3 text-sm outline-none placeholder:text-subtle focus:border-primary focus:bg-surface"
          />
        </label>
      )}

      <ul className="mt-3 space-y-2">
        {options.map((option) => {
          const qty = selection[option.id] ?? 0;
          const price = toCents(option.price);
          const canAdd = canIncrement(group, option.id, selection);
          return (
            <li
              key={option.id}
              className={clsx(
                'flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition',
                qty > 0 ? 'border-primary/50 bg-primary/5' : 'border-line bg-surface',
              )}
            >
              {option.imageUrl && (
                <ProductImage
                  src={option.imageUrl}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{option.name}</p>
                {option.description && (
                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                    {option.description}
                  </p>
                )}
                {price > 0 && (
                  <p className="mt-0.5 text-xs font-semibold text-foreground">
                    + {formatCentsAsBRL(price)}
                  </p>
                )}
              </div>
              {single ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={qty > 0}
                  aria-label={option.name}
                  onClick={() =>
                    onChange(
                      qty > 0 && !required
                        ? decrement(option.id, selection)
                        : increment(group, option.id, selection),
                    )
                  }
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition',
                    qty > 0
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-line-strong',
                  )}
                >
                  {qty > 0 && <Check className="h-3.5 w-3.5" aria-hidden />}
                </button>
              ) : qty === 0 ? (
                <button
                  type="button"
                  onClick={() => onChange(increment(group, option.id, selection))}
                  disabled={!canAdd}
                  aria-label={`Adicionar ${option.name}`}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line-strong text-primary transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <Plus className="h-4 w-4" />
                </button>
              ) : (
                <Stepper
                  value={qty}
                  min={0}
                  max={canAdd ? qty + 1 : qty}
                  label={option.name}
                  small
                  onChange={(next) =>
                    onChange(
                      next > qty
                        ? increment(group, option.id, selection)
                        : decrement(option.id, selection),
                    )
                  }
                />
              )}
            </li>
          );
        })}
        {options.length === 0 && (
          <li className="py-2 text-sm text-muted-foreground">Nenhuma opção encontrada.</li>
        )}
      </ul>
    </section>
  );
}

function Stepper({
  value,
  min,
  max,
  label,
  onChange,
  small = false,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
  small?: boolean;
}) {
  const size = small ? 'h-8 w-8' : 'h-11 w-11';
  return (
    <div
      className={clsx(
        'flex shrink-0 items-center rounded-full border border-line',
        small ? 'gap-1' : 'gap-2',
      )}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={value <= min}
        aria-label={`Diminuir ${label}`}
        className={clsx(
          size,
          'flex items-center justify-center rounded-full text-primary transition disabled:text-subtle',
        )}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-5 text-center text-sm font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Aumentar ${label}`}
        className={clsx(
          size,
          'flex items-center justify-center rounded-full text-primary transition disabled:text-subtle',
        )}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
