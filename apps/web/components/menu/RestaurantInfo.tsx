import clsx from 'clsx';
import { AtSign, Clock, MapPin, MessageCircle, Phone } from 'lucide-react';
import type { PublicRestaurant } from '@/lib/public-menu-api';
import { formatPhone } from '@/lib/customers-logic';
import {
  formatDayHours,
  formatFullAddress,
  instagramUrl,
  mapsUrl,
  telUrl,
  WEEK,
  whatsappUrl,
} from '@/lib/restaurant-profile-logic';

const LINK =
  'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-foreground ' +
  'transition-colors hover:bg-surface-hover touch:py-2';

// The public part of the restaurant profile, above the menu. Server-rendered, no client code.
// Says nothing about what was not informed: a restaurant that never filled in its profile
// shows only its name, as before.
export function RestaurantInfo({ restaurant }: { restaurant: PublicRestaurant }) {
  const address = restaurant.address ? formatFullAddress(restaurant.address) : null;
  const map = restaurant.address ? mapsUrl(restaurant.address) : null;
  const hours = restaurant.openingHours;
  const hasContact = restaurant.phone || restaurant.whatsapp || restaurant.instagram;

  if (!restaurant.description && !address && !hasContact && hours === null) return null;

  return (
    <section aria-label="Sobre o restaurante" className="space-y-3 border-b border-line px-4 py-4">
      {restaurant.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">{restaurant.description}</p>
      )}

      {restaurant.openNow !== null && (
        <p
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium',
            restaurant.openNow ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
          )}
        >
          <span
            aria-hidden
            className={clsx(
              'h-1.5 w-1.5 rounded-full',
              restaurant.openNow ? 'bg-success' : 'bg-danger',
            )}
          />
          {restaurant.openNow ? 'Aberto agora' : 'Fechado agora'}
        </p>
      )}

      {address && (
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
          <span>
            {address}
            {map && (
              <>
                {' · '}
                <a
                  href={map}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Ver no mapa
                </a>
              </>
            )}
          </span>
        </p>
      )}

      {hasContact && (
        <div className="flex flex-wrap gap-2">
          {restaurant.whatsapp && (
            <a
              href={whatsappUrl(restaurant.whatsapp)}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              <MessageCircle className="h-4 w-4 text-accent" aria-hidden />
              WhatsApp
            </a>
          )}
          {restaurant.phone && (
            <a
              href={telUrl(restaurant.phone)}
              className={LINK}
              aria-label={`Ligar para ${formatPhone(restaurant.phone)}`}
            >
              <Phone className="h-4 w-4 text-accent" aria-hidden />
              {formatPhone(restaurant.phone)}
            </a>
          )}
          {restaurant.instagram && (
            <a
              href={instagramUrl(restaurant.instagram)}
              target="_blank"
              rel="noopener noreferrer"
              className={LINK}
            >
              <AtSign className="h-4 w-4 text-accent" aria-hidden />
              {restaurant.instagram}
            </a>
          )}
        </div>
      )}

      {hours !== null && (
        <details className="group rounded-ctl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-sm text-foreground touch:py-3">
            <Clock className="h-4 w-4 text-accent" aria-hidden />
            Horário de funcionamento
            <span className="ml-auto text-xs text-muted-foreground group-open:hidden">ver</span>
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {WEEK.map(({ weekday, label }) => {
              const text = formatDayHours(hours, weekday);
              return (
                <li
                  key={weekday}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="text-foreground">{label}</span>
                  <span
                    className={clsx(
                      'tabular-nums',
                      text === 'Fechado' ? 'text-danger' : 'text-muted-foreground',
                    )}
                  >
                    {text}
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
