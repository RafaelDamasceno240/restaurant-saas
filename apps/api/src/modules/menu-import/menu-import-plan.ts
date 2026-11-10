import { SourceMenu, mapBadges } from './menu-import-source';

// Pure: what importing `menu` into a restaurant whose catalog is `current` would do. Nothing here
// talks to the database, so the dry run and the real run show the very same plan.
//
// Identity: every imported row keeps `externalId = "<prefix>:<source id>"`. Running the import
// again finds its own rows by it and only updates what changed (idempotent). A row created by
// hand that happens to have the same name is never overwritten silently: it is a CONFLICT, and
// only `adoptByName` turns it into an update (and links it to the source from then on).

export type Action = 'create' | 'update' | 'unchanged' | 'conflict' | 'adopt';

export interface Change {
  field: string;
  from: unknown;
  to: unknown;
}

export interface PlanRow<T> {
  action: Action;
  externalId: string;
  name: string;
  existingId: string | null;
  desired: T;
  changes: Change[];
}

export interface DesiredCategory {
  name: string;
  displayOrder: number;
  active: boolean;
}
export interface DesiredGroup {
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
}
export interface DesiredOption {
  groupExternalId: string;
  name: string;
  description: string | null;
  priceCents: number;
  maxQuantity: number;
  soldOut: boolean;
  displayOrder: number;
  active: boolean;
  imageSha: string | null;
}
export interface DesiredProduct {
  categoryExternalId: string;
  name: string;
  description: string | null;
  priceCents: number;
  compareAtPriceCents: number | null;
  displayOrder: number;
  soldOut: boolean;
  featured: boolean;
  badges: ('NEW' | 'VEGETARIAN')[];
  active: boolean;
  imageSha: string | null;
  groupExternalIds: string[];
}

export interface CurrentCatalog {
  categories: {
    id: string;
    externalId: string | null;
    name: string;
    displayOrder: number;
    active: boolean;
  }[];
  groups: {
    id: string;
    externalId: string | null;
    name: string;
    minSelect: number;
    maxSelect: number;
    active: boolean;
  }[];
  options: {
    id: string;
    groupId: string;
    externalId: string | null;
    name: string;
    description: string | null;
    priceCents: number;
    maxQuantity: number;
    soldOut: boolean;
    displayOrder: number;
    active: boolean;
    imageSha: string | null;
  }[];
  products: {
    id: string;
    externalId: string | null;
    categoryId: string;
    name: string;
    description: string | null;
    priceCents: number;
    compareAtPriceCents: number | null;
    displayOrder: number;
    soldOut: boolean;
    featured: boolean;
    badges: string[];
    active: boolean;
    imageSha: string | null;
  }[];
  links: { productId: string; groupId: string; displayOrder: number }[];
}

export interface ImportPlan {
  categories: PlanRow<DesiredCategory>[];
  groups: PlanRow<DesiredGroup>[];
  options: PlanRow<DesiredOption>[];
  products: PlanRow<DesiredProduct>[];
  // Imported earlier (same prefix) but no longer in the source: kept as they are, only reported.
  missingFromSource: { kind: string; name: string; id: string }[];
  skipped: string[];
}

// "Burger  Tudo " and "burger tudo" are the same name; accents too ("Água" = "agua").
export function normalizeName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const clean = (s: string | null | undefined) => (s ? s.replace(/\s+/g, ' ').trim() || null : null);
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function diff(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
  fields: string[],
): Change[] {
  return fields
    .filter((f) => !sameValue(current[f], desired[f]))
    .map((f) => ({ field: f, from: current[f], to: desired[f] }));
}

export function buildPlan(
  menu: SourceMenu,
  current: CurrentCatalog,
  { prefix, adoptByName }: { prefix: string; adoptByName: boolean },
): ImportPlan {
  const ext = (id: string) => `${prefix}:${id}`;
  const skipped: string[] = [];

  // A category is created only when it has something to show: the source may list categories
  // whose products it does not publish.
  const categories = menu.categorias
    .filter((c) => {
      if (c.produtos.length === 0)
        skipped.push(`Categoria "${clean(c.nome)}" sem produtos publicados: não importada.`);
      return c.produtos.length > 0;
    })
    .map((c) => ({
      externalId: ext(c.idOrigem),
      desired: { name: clean(c.nome)!, displayOrder: c.ordem, active: true },
    }));

  const groups = menu.grupos.map((g) => ({
    externalId: ext(g.idOrigem),
    desired: {
      name: clean(g.nome)!,
      minSelect: g.minimo,
      maxSelect: g.maximo,
      active: g.ativo !== false,
    },
  }));

  const options = menu.grupos.flatMap((g) =>
    g.opcoes.map((o) => ({
      externalId: ext(o.idOrigem),
      desired: {
        groupExternalId: ext(g.idOrigem),
        name: clean(o.nome)!,
        description: clean(o.descricao),
        priceCents: o.precoCentavos,
        maxQuantity: o.maximoPorOpcao,
        soldOut: !!o.esgotado,
        displayOrder: o.ordem,
        active: o.ativo !== false,
        imageSha: o.imagem?.sha256 ?? null,
      },
    })),
  );

  const products = menu.produtos.map((p) => ({
    externalId: ext(p.idOrigem),
    desired: {
      categoryExternalId: ext(p.categoriaIdOrigem!),
      name: clean(p.nome)!,
      description: clean(p.descricao),
      priceCents: p.precoCentavos,
      compareAtPriceCents: p.precoDeCentavos ?? null,
      displayOrder: p.ordemNaCategoria ?? 0,
      soldOut: !!p.esgotado,
      featured: !!p.maisPedido,
      badges: mapBadges(p.selos ?? []),
      active: p.ativo !== false,
      imageSha: p.imagem?.sha256 ?? null,
      groupExternalIds: (p.grupos ?? []).map(ext),
    },
  }));

  const groupExtById = new Map(current.groups.map((g) => [g.id, g.externalId]));
  const categoryExtById = new Map(current.categories.map((c) => [c.id, c.externalId]));
  const linksByProduct = new Map<string, { groupId: string; displayOrder: number }[]>();
  for (const l of current.links)
    linksByProduct.set(l.productId, [...(linksByProduct.get(l.productId) ?? []), l]);

  // Matches a desired row with an existing one: by externalId, else (by name) as a conflict.
  function match<
    C extends { id: string; externalId: string | null; name: string },
    D extends { name: string },
  >(
    rows: { externalId: string; desired: D }[],
    existing: C[],
    sameScope: (c: C, d: D) => boolean,
    compare: (c: C, d: D) => Change[],
  ): PlanRow<D>[] {
    const byExt = new Map(existing.filter((c) => c.externalId).map((c) => [c.externalId!, c]));
    const taken = new Set<string>();
    return rows.map(({ externalId, desired }) => {
      const own = byExt.get(externalId);
      if (own) {
        taken.add(own.id);
        const changes = compare(own, desired);
        return {
          action: changes.length ? 'update' : 'unchanged',
          externalId,
          name: desired.name,
          existingId: own.id,
          desired,
          changes,
        };
      }
      const homonym = existing.find(
        (c) =>
          !taken.has(c.id) &&
          c.externalId === null &&
          normalizeName(c.name) === normalizeName(desired.name) &&
          sameScope(c, desired),
      );
      if (homonym) {
        taken.add(homonym.id);
        return {
          action: adoptByName ? 'adopt' : 'conflict',
          externalId,
          name: desired.name,
          existingId: homonym.id,
          desired,
          changes: compare(homonym, desired),
        };
      }
      return {
        action: 'create',
        externalId,
        name: desired.name,
        existingId: null,
        desired,
        changes: [],
      };
    });
  }

  const plannedCategories = match(
    categories,
    current.categories,
    () => true,
    (c, d) => diff(c, d as unknown as Record<string, unknown>, ['name', 'displayOrder', 'active']),
  );
  const plannedGroups = match(
    groups,
    current.groups,
    () => true,
    (c, d) =>
      diff(c, d as unknown as Record<string, unknown>, [
        'name',
        'minSelect',
        'maxSelect',
        'active',
      ]),
  );
  // An option belongs to its group: a homonym only counts inside the group it would join.
  const groupIdByExt = new Map(
    plannedGroups.filter((g) => g.existingId).map((g) => [g.externalId, g.existingId!]),
  );
  const plannedOptions = match(
    options,
    current.options,
    (c, d) => groupIdByExt.get(d.groupExternalId) === c.groupId,
    (c, d) =>
      diff(
        { ...c, groupExternalId: groupExtById.get(c.groupId) ?? null },
        d as unknown as Record<string, unknown>,
        [
          'groupExternalId',
          'name',
          'description',
          'priceCents',
          'maxQuantity',
          'soldOut',
          'displayOrder',
          'active',
          'imageSha',
        ],
      ),
  );
  const plannedProducts = match(
    products,
    current.products,
    () => true,
    (c, d) => {
      const links = (linksByProduct.get(c.id) ?? [])
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((l) => groupExtById.get(l.groupId) ?? `?${l.groupId}`);
      return diff(
        {
          ...c,
          categoryExternalId: categoryExtById.get(c.categoryId) ?? `?${c.categoryId}`,
          badges: [...c.badges].sort(),
          groupExternalIds: links,
        },
        { ...d, badges: [...d.badges].sort() } as unknown as Record<string, unknown>,
        [
          'categoryExternalId',
          'name',
          'description',
          'priceCents',
          'compareAtPriceCents',
          'displayOrder',
          'soldOut',
          'featured',
          'badges',
          'active',
          'imageSha',
          'groupExternalIds',
        ],
      );
    },
  );

  const wanted = new Set(
    [...categories, ...groups, ...options, ...products].map((r) => r.externalId),
  );
  const missingFromSource = [
    ...current.categories.map((c) => ({ kind: 'categoria', ...c })),
    ...current.groups.map((g) => ({ kind: 'grupo', ...g })),
    ...current.options.map((o) => ({ kind: 'adicional', ...o })),
    ...current.products.map((p) => ({ kind: 'produto', ...p })),
  ]
    .filter((r) => r.externalId?.startsWith(`${prefix}:`) && !wanted.has(r.externalId))
    .map((r) => ({ kind: r.kind, name: r.name, id: r.id }));

  return {
    categories: plannedCategories,
    groups: plannedGroups,
    options: plannedOptions,
    products: plannedProducts,
    missingFromSource,
    skipped,
  };
}

export function countActions(plan: ImportPlan) {
  const count = (rows: PlanRow<unknown>[]) =>
    rows.reduce<Record<Action, number>>((acc, r) => ({ ...acc, [r.action]: acc[r.action] + 1 }), {
      create: 0,
      update: 0,
      unchanged: 0,
      conflict: 0,
      adopt: 0,
    });
  return {
    categorias: count(plan.categories),
    grupos: count(plan.groups),
    adicionais: count(plan.options),
    produtos: count(plan.products),
  };
}

export function hasConflicts(plan: ImportPlan): boolean {
  return [plan.categories, plan.groups, plan.options, plan.products].some((rows) =>
    rows.some((r) => r.action === 'conflict'),
  );
}
