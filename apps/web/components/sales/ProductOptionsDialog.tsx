'use client';

import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Minus, Plus } from 'lucide-react';
import { Dialog } from '@/components/ds/Dialog';
import { Button } from '@/components/ds/Button';
import { LoadingState } from '@/components/ds/States';
import { formatCentsAsBRL, toCents } from '@/lib/money';
import { chosenOptions, decrement, groupRuleText, increment, isSingleChoice } from '@/lib/menu-display';
import {
  PersonalizedLine,
  Selection,
  StaffOptionGroup,
  blockedRequiredGroup,
  buildPersonalizedLine,
  canPick,
  extrasCents,
  missingGroup,
  selectedUnits,
} from '@/lib/staff-addons';

export interface ProductOptionsInitial {
  selection: Selection;
  notes: string;
  quantity: number;
  // Add-ons of the saved line that cannot be chosen any more (sold out or removed meanwhile).
  droppedCount?: number;
}

// The personalization of ONE product for the counter or a table: its add-on groups (required ones
// marked and checked before confirming), a note for the kitchen, how many units and the price of
// all of it, updated on every tap. The price here is an estimate from the menu the screen loaded:
// the line goes to the server as ids and quantities only and is priced there.
export function ProductOptionsDialog({
  open,
  product,
  groups,
  loading = false,
  initial,
  maxQuantity,
  noteMax,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  product: { id: string; name: string; price: number; imageUrl?: string | null } | null;
  groups: StaffOptionGroup[];
  loading?: boolean;
  initial?: ProductOptionsInitial | null;
  // Units still allowed for this product (B7: 50 per product on the sale or the tab).
  maxQuantity: number;
  noteMax: number;
  confirmLabel: string;
  onConfirm: (line: PersonalizedLine) => void;
  onClose: () => void;
}) {
  const [selection, setSelection] = useState<Selection>({});
  const [notes, setNotes] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [highlight, setHighlight] = useState<string | null>(null);
  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  // Each opening starts from the line being edited, or from scratch.
  useEffect(() => {
    if (!open) return;
    setSelection(initial?.selection ?? {});
    setNotes(initial?.notes ?? '');
    setQuantity(Math.max(1, Math.min(initial?.quantity ?? 1, Math.max(1, maxQuantity))));
    setHighlight(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  if (!product) return null;

  const chosen = chosenOptions(groups, selection);
  const baseCents = toCents(product.price);
  const extras = extrasCents(chosen);
  const unitCents = baseCents + extras;
  const missing = missingGroup(groups, selection);
  const blocked = blockedRequiredGroup(groups);
  const noRoom = maxQuantity < 1;

  function confirm() {
    if (!product || blocked || noRoom) return;
    if (missing) {
      setHighlight(missing.id);
      const el = groupRefs.current[missing.id];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
      return;
    }
    onConfirm(buildPersonalizedLine(product, groups, selection, notes, Math.min(quantity, maxQuantity)));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={product.name}
      description={`${formatCentsAsBRL(baseCents)} · personalize o item`}
      size="lg"
      footer={
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm" aria-live="polite">
            {(extras > 0 || quantity > 1) && (
              <p className="text-muted-foreground">
                {formatCentsAsBRL(baseCents)}
                {extras > 0 && <> + {formatCentsAsBRL(extras)} em adicionais</>}
                {quantity > 1 && <> · {quantity} un.</>}
              </p>
            )}
            <p className="text-lg font-bold tabular-nums text-foreground">{formatCentsAsBRL(unitCents * quantity)}</p>
            <p className="text-2xs text-subtle">O valor final é calculado pelo sistema ao lançar.</p>
          </div>
          <div className="flex items-center gap-2">
            <QuantityStepper value={quantity} min={1} max={Math.max(1, maxQuantity)} label={product.name} onChange={setQuantity} />
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={confirm} disabled={!!blocked || noRoom || loading} aria-describedby={missing ? 'opcoes-pendentes' : undefined}>
              {confirmLabel}
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <LoadingState label="Carregando adicionais..." />
      ) : (
        <div
          className="space-y-4"
          onKeyDown={(e) => {
            // Ctrl/Cmd + Enter confirms from anywhere in the form (the note included).
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              confirm();
            }
          }}
        >
          {initial?.droppedCount ? (
            <p role="status" className="flex items-start gap-2 rounded-ctl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {initial.droppedCount === 1
                ? 'Um adicional escolhido antes não está mais disponível e foi retirado.'
                : `${initial.droppedCount} adicionais escolhidos antes não estão mais disponíveis e foram retirados.`}
            </p>
          ) : null}
          {blocked && (
            <p role="alert" className="flex items-start gap-2 rounded-ctl border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Não há opções disponíveis em &quot;{blocked.name}&quot;, que é obrigatório. Este produto não pode ser vendido agora.
            </p>
          )}
          {noRoom && (
            <p role="alert" className="text-sm text-danger">
              Limite de unidades deste produto atingido.
            </p>
          )}
          {missing && highlight && (
            <p id="opcoes-pendentes" role="alert" className="text-sm font-semibold text-danger">
              Escolha {missing.minSelect === 1 ? 'uma opção' : `pelo menos ${missing.minSelect} opções`} em &quot;{missing.name}&quot;.
            </p>
          )}

          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              selection={selection}
              highlighted={highlight === group.id}
              refCallback={(el) => {
                groupRefs.current[group.id] = el;
              }}
              onChange={(next) => {
                setSelection(next);
                if (highlight === group.id && selectedUnits(group, next) >= group.minSelect) setHighlight(null);
              }}
            />
          ))}

          <div>
            <label htmlFor="observacao-item" className="flex items-baseline justify-between text-sm font-semibold text-foreground">
              Observação para a cozinha
              <span className="text-2xs font-normal text-subtle">
                {notes.length}/{noteMax}
              </span>
            </label>
            <textarea
              id="observacao-item"
              value={notes}
              maxLength={noteMax}
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex.: sem cebola, bem passado..."
              className="mt-1.5 w-full resize-none rounded-ctl border border-line-strong bg-surface-2 px-3 py-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-accent"
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}

function GroupSection({
  group,
  selection,
  highlighted,
  refCallback,
  onChange,
}: {
  group: StaffOptionGroup;
  selection: Selection;
  highlighted: boolean;
  refCallback: (el: HTMLElement | null) => void;
  onChange: (next: Selection) => void;
}) {
  const units = selectedUnits(group, selection);
  const required = group.minSelect > 0;
  const satisfied = units >= group.minSelect;
  const single = isSingleChoice(group);
  const headingId = `grupo-pdv-${group.id}`;

  return (
    <fieldset
      ref={refCallback}
      aria-labelledby={headingId}
      className={clsx(
        'rounded-card border p-3 transition-colors',
        highlighted ? 'border-danger ring-2 ring-danger/40' : required && !satisfied ? 'border-accent/60' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="text-sm font-bold text-foreground">
            {group.name}
          </h3>
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
                'flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wide',
                satisfied ? 'bg-success/15 text-success' : 'bg-accent text-accent-foreground',
              )}
            >
              {satisfied && <Check className="h-3 w-3" aria-hidden />}
              Obrigatório
            </span>
          )}
        </div>
      </div>

      <ul className="mt-2 grid gap-2 sm:grid-cols-2" role={single ? 'radiogroup' : undefined} aria-labelledby={single ? headingId : undefined}>
        {group.options.map((option) => {
          const qty = selection[option.id] ?? 0;
          const price = toCents(option.price);
          const pickable = canPick(group, option.id, selection);
          return (
            <li
              key={option.id}
              className={clsx(
                'flex min-h-14 items-center gap-2 rounded-ctl border px-3 py-2 transition-colors',
                option.soldOut ? 'border-line bg-surface-2 opacity-60' : qty > 0 ? 'border-accent bg-accent/10' : 'border-line bg-surface',
              )}
            >
              <div className="min-w-0 flex-1">
                <p className={clsx('text-sm font-medium text-foreground', option.soldOut && 'line-through')}>{option.name}</p>
                <p className="text-xs text-muted-foreground">
                  {option.soldOut ? 'Esgotado' : price > 0 ? `+ ${formatCentsAsBRL(price)}` : 'Sem custo'}
                </p>
              </div>
              {single ? (
                <button
                  type="button"
                  role="radio"
                  aria-checked={qty > 0}
                  aria-label={`${option.name}${option.soldOut ? ' (esgotado)' : ''}`}
                  disabled={option.soldOut}
                  onClick={() => onChange(qty > 0 && !required ? decrement(option.id, selection) : increment(group, option.id, selection))}
                  className={clsx(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed touch:h-11 touch:w-11',
                    qty > 0 ? 'border-accent bg-accent text-accent-foreground' : 'border-line-strong',
                  )}
                >
                  {qty > 0 && <Check className="h-4 w-4" aria-hidden />}
                </button>
              ) : (
                <QuantityStepper
                  value={qty}
                  min={0}
                  max={pickable ? qty + 1 : qty}
                  label={option.name}
                  disabled={option.soldOut}
                  small
                  onChange={(next) => onChange(next > qty ? increment(group, option.id, selection) : decrement(option.id, selection))}
                />
              )}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function QuantityStepper({
  value,
  min,
  max,
  label,
  onChange,
  disabled = false,
  small = false,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  small?: boolean;
}) {
  const size = small ? 'h-9 w-9 touch:h-11 touch:w-11' : 'h-10 w-10 touch:h-11 touch:w-11';
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-ctl border border-line bg-surface-2 p-0.5">
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={disabled || value <= min}
        aria-label={`Diminuir ${label}`}
        className={clsx(size, 'flex items-center justify-center rounded-md text-foreground transition-colors hover:bg-surface-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-35')}
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-label={`${value} de ${label}`}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={disabled || value >= max}
        aria-label={`Aumentar ${label}`}
        className={clsx(size, 'flex items-center justify-center rounded-md text-foreground transition-colors hover:bg-surface-hover active:scale-95 disabled:cursor-not-allowed disabled:opacity-35')}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
