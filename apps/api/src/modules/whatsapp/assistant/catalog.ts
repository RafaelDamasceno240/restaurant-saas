import { toCents } from '../../../common/util/money.util';
import { PublicMenuResponseDto } from '../../public-menu/dto/public-menu-response.dto';

// What the assistant may know about a restaurant: exactly the PUBLIC menu (PublicMenuService), the
// same data anyone sees on /menu/<slug>. No cost, stock, recipe or internal flag ever reaches it.

export interface CatalogOption {
  id: string;
  name: string;
  priceCents: number;
  maxQuantity: number;
}

export interface CatalogGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: CatalogOption[];
}

export interface CatalogProduct {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  soldOut: boolean;
  categoryId: string;
  categoryName: string;
  groups: CatalogGroup[];
}

export interface OpeningIntervalView {
  weekday: number;
  opens: string;
  closes: string;
}

export interface Catalog {
  restaurantName: string;
  slug: string;
  categories: { id: string; name: string; productIds: string[] }[];
  products: CatalogProduct[];
  openingHours: OpeningIntervalView[] | null;
  openNow: boolean | null;
  delivery: {
    enabled: boolean;
    feeCents: number;
    minOrderCents: number;
    freeAboveCents: number | null;
  };
}

export function catalogFromPublicMenu(menu: PublicMenuResponseDto): Catalog {
  const products: CatalogProduct[] = [];
  const categories = menu.categories.map((category) => {
    for (const product of category.products) {
      products.push({
        id: product.id,
        name: product.name,
        description: product.description,
        priceCents: toCents(product.price),
        soldOut: product.soldOut,
        categoryId: category.id,
        categoryName: category.name,
        groups: product.optionGroups.map((group) => ({
          id: group.id,
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          options: group.options.map((option) => ({
            id: option.id,
            name: option.name,
            priceCents: toCents(option.price),
            maxQuantity: option.maxQuantity,
          })),
        })),
      });
    }
    return { id: category.id, name: category.name, productIds: category.products.map((p) => p.id) };
  });
  return {
    restaurantName: menu.restaurant.name,
    slug: menu.restaurant.slug,
    categories,
    products,
    openingHours: menu.restaurant.openingHours,
    openNow: menu.restaurant.openNow,
    delivery: {
      enabled: menu.delivery.enabled,
      feeCents: toCents(menu.delivery.fee),
      minOrderCents: toCents(menu.delivery.minOrder),
      freeAboveCents: menu.delivery.freeAbove === null ? null : toCents(menu.delivery.freeAbove),
    },
  };
}

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export function describeOpeningHours(hours: OpeningIntervalView[] | null): string[] {
  if (hours === null) return [];
  return WEEKDAYS.map((name, weekday) => {
    const today = hours.filter((h) => h.weekday === weekday);
    return today.length === 0
      ? `${name}: fechado`
      : `${name}: ${today.map((h) => `${h.opens} às ${h.closes}`).join(' e ')}`;
  });
}
