import { formatCentsAsBRL } from '@/lib/money';

// The add-ons and the note of one line, under its name (cart, checkout and order pages).
export function CartLineDetails({
  options,
  notes,
}: {
  options: { name: string; quantity: number; priceCents?: number }[];
  notes: string | null | undefined;
}) {
  if (options.length === 0 && !notes) return null;
  return (
    <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {options.map((o, i) => (
        <p key={`${o.name}-${i}`}>
          + {o.quantity > 1 ? `${o.quantity}× ` : ''}
          {o.name}
          {o.priceCents ? ` (${formatCentsAsBRL(o.priceCents * o.quantity)})` : ''}
        </p>
      ))}
      {notes && <p className="italic">Obs.: {notes}</p>}
    </div>
  );
}
