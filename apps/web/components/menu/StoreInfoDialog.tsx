'use client';

import clsx from 'clsx';
import {
  AtSign,
  Bike,
  Clock,
  MapPin,
  MessageCircle,
  Phone,
  ShoppingBag,
  Wallet,
} from 'lucide-react';
import { Dialog } from '@/components/ds/Dialog';
import type { PublicMenuDelivery, PublicRestaurant } from '@/lib/public-menu-api';
import { formatPhone } from '@/lib/customers-logic';
import { formatCentsAsBRL, toCents } from '@/lib/money';
import {
  formatDayHours,
  formatFullAddress,
  instagramUrl,
  mapsUrl,
  telUrl,
  WEEK,
  whatsappUrl,
} from '@/lib/restaurant-profile-logic';

const SECTION = 'space-y-2 border-b border-line pb-4 last:border-b-0 last:pb-0';
const HEADING = 'flex items-center gap-2 text-sm font-semibold text-foreground';

// Everything the restaurant published about itself, in one sheet (bottom sheet on a phone).
// Payment: the public checkout records how the customer will pay on delivery/pickup; nothing is
// charged online, so the sheet says exactly that.
export function StoreInfoDialog({
  open,
  onClose,
  restaurant,
  delivery,
}: {
  open: boolean;
  onClose: () => void;
  restaurant: PublicRestaurant;
  delivery: PublicMenuDelivery;
}) {
  const address = restaurant.address ? formatFullAddress(restaurant.address) : null;
  const map = restaurant.address ? mapsUrl(restaurant.address) : null;
  const hours = restaurant.openingHours;
  const fee = toCents(delivery.fee);
  const minOrder = toCents(delivery.minOrder);
  const freeAbove = delivery.freeAbove ? toCents(delivery.freeAbove) : null;

  return (
    <Dialog open={open} onClose={onClose} title="Informações da loja" size="md">
      <div className="space-y-4 text-sm">
        {restaurant.description && (
          <p className="leading-relaxed text-muted-foreground">{restaurant.description}</p>
        )}

        {hours !== null && (
          <section className={SECTION}>
            <h3 className={HEADING}>
              <Clock className="h-4 w-4 text-primary" aria-hidden /> Horários de funcionamento
            </h3>
            <ul className="space-y-1">
              {WEEK.map(({ weekday, label }) => {
                const text = formatDayHours(hours, weekday);
                return (
                  <li key={weekday} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{label}</span>
                    <span
                      className={clsx(
                        'tabular-nums',
                        text === 'Fechado' ? 'text-subtle' : 'text-foreground',
                      )}
                    >
                      {text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className={SECTION}>
          <h3 className={HEADING}>
            <ShoppingBag className="h-4 w-4 text-primary" aria-hidden /> Como pedir
          </h3>
          <p className="flex items-center gap-2 text-muted-foreground">
            <Bike className="h-4 w-4" aria-hidden />
            {delivery.enabled
              ? `Entrega: taxa ${fee > 0 ? formatCentsAsBRL(fee) : 'grátis'}${minOrder > 0 ? ` · pedido mínimo ${formatCentsAsBRL(minOrder)}` : ''}`
              : 'Entrega indisponível no momento'}
            {delivery.enabled &&
              fee > 0 &&
              freeAbove !== null &&
              ` · grátis a partir de ${formatCentsAsBRL(freeAbove)}`}
          </p>
          <p className="flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" aria-hidden /> Retirada no local
          </p>
        </section>

        <section className={SECTION}>
          <h3 className={HEADING}>
            <Wallet className="h-4 w-4 text-primary" aria-hidden /> Formas de pagamento
          </h3>
          <p className="text-muted-foreground">Na entrega ou na retirada:</p>
          <div className="flex flex-wrap gap-2">
            {['Dinheiro', 'Pix', 'Cartão'].map((m) => (
              <span
                key={m}
                className="rounded-full border border-line bg-surface-2 px-3 py-1 text-foreground"
              >
                {m}
              </span>
            ))}
          </div>
        </section>

        {address && (
          <section className={SECTION}>
            <h3 className={HEADING}>
              <MapPin className="h-4 w-4 text-primary" aria-hidden /> Endereço
            </h3>
            <p className="text-muted-foreground">
              {address}
              {map && (
                <>
                  {' · '}
                  <a
                    href={map}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    Ver no mapa
                  </a>
                </>
              )}
            </p>
          </section>
        )}

        {(restaurant.whatsapp || restaurant.phone || restaurant.instagram) && (
          <section className="flex flex-col gap-2">
            {restaurant.whatsapp && (
              <a
                href={whatsappUrl(restaurant.whatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                <MessageCircle className="h-4 w-4" aria-hidden /> Chamar no WhatsApp
              </a>
            )}
            <div className="flex flex-wrap gap-2">
              {restaurant.phone && (
                <a
                  href={telUrl(restaurant.phone)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-foreground"
                >
                  <Phone className="h-4 w-4 text-primary" aria-hidden />{' '}
                  {formatPhone(restaurant.phone)}
                </a>
              )}
              {restaurant.instagram && (
                <a
                  href={instagramUrl(restaurant.instagram)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-foreground"
                >
                  <AtSign className="h-4 w-4 text-primary" aria-hidden /> {restaurant.instagram}
                </a>
              )}
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
