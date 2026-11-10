import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import { checkImage } from '../media/media-content';
import { CurrentCatalog, ImportPlan } from './menu-import-plan';
import { SourceImage, SourceMenu } from './menu-import-source';

type Db = Prisma.TransactionClient | PrismaClient;

export interface LoadedImage {
  sha256: string;
  contentType: string;
  bytes: Buffer;
}

// Reads every image the source names from `dir`, checks it (format by its bytes, size) and writes
// the REAL sha256 back into the source, so the plan compares what is actually on disk. An image
// that is missing or refused becomes "no image" for its row, with a warning; it never stops the
// rest of the import.
export function loadImages(
  menu: SourceMenu,
  dir: string | null,
): { images: Map<string, LoadedImage>; warnings: string[] } {
  const images = new Map<string, LoadedImage>();
  const warnings: string[] = [];
  const load = (img: SourceImage | null | undefined, owner: string) => {
    if (!img) return;
    if (!dir || !img.arquivo) {
      img.sha256 = null;
      return;
    }
    const path = join(dir, img.arquivo);
    if (!existsSync(path)) {
      warnings.push(`${owner}: arquivo de imagem não encontrado (${img.arquivo}).`);
      img.sha256 = null;
      return;
    }
    const bytes = readFileSync(path);
    const check = checkImage(bytes);
    if (!check.ok) {
      warnings.push(`${owner}: imagem recusada (${img.arquivo}: ${check.reason}).`);
      img.sha256 = null;
      return;
    }
    if (img.sha256 && img.sha256 !== check.sha256)
      warnings.push(`${owner}: a imagem mudou desde a extração (hash diferente).`);
    img.sha256 = check.sha256;
    images.set(check.sha256, { sha256: check.sha256, contentType: check.contentType, bytes });
  };
  load(menu.loja.logo, 'Logo');
  load(menu.loja.capa, 'Capa');
  for (const p of menu.produtos) load(p.imagem, `Produto "${p.nome}"`);
  for (const g of menu.grupos) for (const o of g.opcoes) load(o.imagem, `Adicional "${o.nome}"`);
  return { images, warnings };
}

export async function readCatalog(
  db: Db,
  tenantId: string,
): Promise<CurrentCatalog & { mediaShaById: Map<string, string> }> {
  const [media, categories, groups, options, products, links] = await Promise.all([
    db.mediaAsset.findMany({ where: { tenantId }, select: { id: true, sha256: true } }),
    db.category.findMany({
      where: { tenantId },
      select: { id: true, externalId: true, name: true, displayOrder: true, active: true },
    }),
    db.optionGroup.findMany({
      where: { tenantId },
      select: {
        id: true,
        externalId: true,
        name: true,
        minSelect: true,
        maxSelect: true,
        active: true,
      },
    }),
    db.optionItem.findMany({
      where: { tenantId },
      select: {
        id: true,
        groupId: true,
        externalId: true,
        name: true,
        description: true,
        priceCents: true,
        maxQuantity: true,
        soldOut: true,
        displayOrder: true,
        active: true,
        imageMediaId: true,
      },
    }),
    db.product.findMany({
      where: { tenantId },
      select: {
        id: true,
        externalId: true,
        categoryId: true,
        name: true,
        description: true,
        priceCents: true,
        compareAtPriceCents: true,
        displayOrder: true,
        soldOut: true,
        featured: true,
        badges: true,
        active: true,
        imageMediaId: true,
      },
    }),
    db.productOptionGroup.findMany({
      where: { tenantId },
      select: { productId: true, groupId: true, displayOrder: true },
    }),
  ]);
  const mediaShaById = new Map(media.map((m) => [m.id, m.sha256]));
  const sha = (id: string | null) => (id ? (mediaShaById.get(id) ?? null) : null);
  return {
    mediaShaById,
    categories,
    groups,
    options: options.map(({ imageMediaId, ...o }) => ({ ...o, imageSha: sha(imageMediaId) })),
    products: products.map(({ imageMediaId, ...p }) => ({ ...p, imageSha: sha(imageMediaId) })),
    links,
  };
}

// What a run changed, kept in the report so it can be undone (--desfazer).
export interface AppliedChanges {
  tenantId: string;
  created: {
    media: string[];
    categories: string[];
    groups: string[];
    options: string[];
    products: string[];
  };
  // Previous values of every row the run updated (adopted rows included: externalId was null).
  updated: {
    kind: 'category' | 'group' | 'option' | 'product';
    id: string;
    before: Record<string, unknown>;
  }[];
  // Option-group links of each touched product before the run.
  linksBefore: Record<string, { groupId: string; displayOrder: number }[]>;
  tenantBefore: Record<string, unknown> | null;
  branchBefore: { id: string; values: Record<string, unknown> } | null;
}

export interface StoreUpdate {
  // Logo and cover from the source.
  identity: boolean;
  brandColor: string | null;
  // Opening hours, WhatsApp, address, delivery fee and minimum order, on the default branch.
  branch: { branchId: string; values: Prisma.BranchUpdateInput & Record<string, unknown> } | null;
}

const pick = (row: Record<string, unknown>, fields: string[]) =>
  Object.fromEntries(fields.map((f) => [f, row[f]]));

export async function applyPlan(
  tx: Prisma.TransactionClient,
  tenantId: string,
  menu: SourceMenu,
  plan: ImportPlan,
  images: Map<string, LoadedImage>,
  store: StoreUpdate,
): Promise<AppliedChanges> {
  const applied: AppliedChanges = {
    tenantId,
    created: { media: [], categories: [], groups: [], options: [], products: [] },
    updated: [],
    linksBefore: {},
    tenantBefore: null,
    branchBefore: null,
  };

  // Images first: content-addressed, so the same photo is stored once per restaurant.
  const mediaIdBySha = new Map<string, string>();
  for (const m of await tx.mediaAsset.findMany({
    where: { tenantId },
    select: { id: true, sha256: true },
  })) {
    mediaIdBySha.set(m.sha256, m.id);
  }
  const mediaFor = async (sha: string | null): Promise<string | null> => {
    if (!sha) return null;
    const known = mediaIdBySha.get(sha);
    if (known) return known;
    const image = images.get(sha);
    if (!image) return null;
    const created = await tx.mediaAsset.create({
      data: {
        tenantId,
        contentType: image.contentType,
        sizeBytes: image.bytes.length,
        sha256: sha,
        data: image.bytes,
      },
      select: { id: true },
    });
    applied.created.media.push(created.id);
    mediaIdBySha.set(sha, created.id);
    return created.id;
  };

  const write = <T extends { action: string; existingId: string | null; externalId: string }>(
    rows: T[],
  ) => rows.filter((r) => r.action === 'create' || r.action === 'update' || r.action === 'adopt');

  const categoryId = new Map<string, string>();
  for (const row of plan.categories)
    if (row.existingId) categoryId.set(row.externalId, row.existingId);
  for (const row of write(plan.categories)) {
    const data = {
      name: row.desired.name,
      displayOrder: row.desired.displayOrder,
      active: row.desired.active,
    };
    if (row.action === 'create') {
      const c = await tx.category.create({
        data: { ...data, tenantId, externalId: row.externalId },
        select: { id: true },
      });
      applied.created.categories.push(c.id);
      categoryId.set(row.externalId, c.id);
    } else {
      const before = await tx.category.findUniqueOrThrow({ where: { id: row.existingId! } });
      applied.updated.push({
        kind: 'category',
        id: before.id,
        before: pick(before, ['name', 'displayOrder', 'active', 'externalId']),
      });
      await tx.category.update({
        where: { id: before.id },
        data: { ...data, externalId: row.externalId },
      });
    }
  }

  const groupId = new Map<string, string>();
  for (const row of plan.groups) if (row.existingId) groupId.set(row.externalId, row.existingId);
  for (const row of write(plan.groups)) {
    const data = row.desired;
    if (row.action === 'create') {
      const g = await tx.optionGroup.create({
        data: { ...data, tenantId, externalId: row.externalId },
        select: { id: true },
      });
      applied.created.groups.push(g.id);
      groupId.set(row.externalId, g.id);
    } else {
      const before = await tx.optionGroup.findUniqueOrThrow({ where: { id: row.existingId! } });
      applied.updated.push({
        kind: 'group',
        id: before.id,
        before: pick(before, ['name', 'minSelect', 'maxSelect', 'active', 'externalId']),
      });
      await tx.optionGroup.update({
        where: { id: before.id },
        data: { ...data, externalId: row.externalId },
      });
    }
  }

  for (const row of write(plan.options)) {
    const { groupExternalId, imageSha, ...rest } = row.desired;
    const data = {
      ...rest,
      groupId: groupId.get(groupExternalId)!,
      imageMediaId: await mediaFor(imageSha),
    };
    if (row.action === 'create') {
      const o = await tx.optionItem.create({
        data: { ...data, tenantId, externalId: row.externalId },
        select: { id: true },
      });
      applied.created.options.push(o.id);
    } else {
      const before = await tx.optionItem.findUniqueOrThrow({ where: { id: row.existingId! } });
      applied.updated.push({
        kind: 'option',
        id: before.id,
        before: pick(before, [
          'groupId',
          'name',
          'description',
          'priceCents',
          'maxQuantity',
          'soldOut',
          'displayOrder',
          'active',
          'imageMediaId',
          'externalId',
        ]),
      });
      await tx.optionItem.update({
        where: { id: before.id },
        data: { ...data, externalId: row.externalId },
      });
    }
  }

  const importedGroupIds = new Set(groupId.values());
  for (const row of write(plan.products)) {
    const { categoryExternalId, imageSha, groupExternalIds, ...rest } = row.desired;
    const data = {
      ...rest,
      categoryId: categoryId.get(categoryExternalId)!,
      imageMediaId: await mediaFor(imageSha),
    };
    let productId: string;
    if (row.action === 'create') {
      const p = await tx.product.create({
        data: { ...data, tenantId, externalId: row.externalId },
        select: { id: true },
      });
      applied.created.products.push(p.id);
      productId = p.id;
    } else {
      const before = await tx.product.findUniqueOrThrow({ where: { id: row.existingId! } });
      applied.updated.push({
        kind: 'product',
        id: before.id,
        before: pick(before, [
          'categoryId',
          'name',
          'description',
          'priceCents',
          'compareAtPriceCents',
          'displayOrder',
          'soldOut',
          'featured',
          'badges',
          'active',
          'imageMediaId',
          'externalId',
        ]),
      });
      await tx.product.update({
        where: { id: before.id },
        data: { ...data, externalId: row.externalId },
      });
      productId = before.id;
    }

    // Links: exactly the source's groups, in its order. A link to a group the import does not
    // manage (created by hand) is left alone.
    const links = await tx.productOptionGroup.findMany({
      where: { productId },
      select: { groupId: true, displayOrder: true },
    });
    applied.linksBefore[productId] = links;
    const desiredGroups = groupExternalIds.map((e) => groupId.get(e)!);
    const stale = links
      .filter((l) => importedGroupIds.has(l.groupId) && !desiredGroups.includes(l.groupId))
      .map((l) => l.groupId);
    if (stale.length)
      await tx.productOptionGroup.deleteMany({ where: { productId, groupId: { in: stale } } });
    for (const [index, gid] of desiredGroups.entries()) {
      await tx.productOptionGroup.upsert({
        where: { productId_groupId: { productId, groupId: gid } },
        create: { tenantId, productId, groupId: gid, displayOrder: index },
        update: { displayOrder: index },
      });
    }
  }

  if (store.identity || store.brandColor) {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    applied.tenantBefore = pick(tenant, ['logoMediaId', 'coverMediaId', 'brandColor']);
    await tx.tenant.update({
      where: { id: tenantId },
      data: {
        ...(store.identity
          ? {
              logoMediaId: (await mediaFor(menu.loja.logo?.sha256 ?? null)) ?? tenant.logoMediaId,
              coverMediaId: (await mediaFor(menu.loja.capa?.sha256 ?? null)) ?? tenant.coverMediaId,
            }
          : {}),
        ...(store.brandColor ? { brandColor: store.brandColor } : {}),
      },
    });
  }
  if (store.branch) {
    const fields = Object.keys(store.branch.values);
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: store.branch.branchId } });
    applied.branchBefore = { id: branch.id, values: pick(branch, fields) };
    await tx.branch.update({ where: { id: branch.id }, data: store.branch.values });
  }
  return applied;
}

// Undoes one run, from its report. Restores every updated row and every touched product's links,
// then removes what the run created. A created product or category that is already used (an
// order, a tab) is deactivated instead of deleted: history never loses its rows.
export async function undoApplied(
  tx: Prisma.TransactionClient,
  applied: AppliedChanges,
): Promise<string[]> {
  const notes: string[] = [];
  const { tenantId } = applied;
  for (const u of applied.updated) {
    const where = { id: u.id, tenantId };
    const data = u.before as never;
    if (u.kind === 'category') await tx.category.updateMany({ where, data });
    if (u.kind === 'group') await tx.optionGroup.updateMany({ where, data });
    if (u.kind === 'option') await tx.optionItem.updateMany({ where, data });
    if (u.kind === 'product') await tx.product.updateMany({ where, data });
  }
  for (const [productId, links] of Object.entries(applied.linksBefore)) {
    if (applied.created.products.includes(productId)) continue;
    await tx.productOptionGroup.deleteMany({ where: { productId, tenantId } });
    for (const l of links)
      await tx.productOptionGroup.create({ data: { tenantId, productId, ...l } });
  }
  for (const id of applied.created.products) {
    const used =
      (await tx.orderItem.count({ where: { productId: id } })) +
      (await tx.tabItem.count({ where: { productId: id } }));
    if (used) {
      await tx.product.updateMany({ where: { id, tenantId }, data: { active: false } });
      notes.push(`Produto ${id} já tem pedidos: desativado em vez de apagado.`);
    } else {
      await tx.productRecipe.deleteMany({ where: { productId: id, tenantId } });
      await tx.product.deleteMany({ where: { id, tenantId } });
    }
  }
  await tx.optionItem.deleteMany({ where: { id: { in: applied.created.options }, tenantId } });
  await tx.optionGroup.deleteMany({ where: { id: { in: applied.created.groups }, tenantId } });
  for (const id of applied.created.categories) {
    if (await tx.product.count({ where: { categoryId: id } })) {
      await tx.category.updateMany({ where: { id, tenantId }, data: { active: false } });
      notes.push(`Categoria ${id} ainda tem produtos: desativada em vez de apagada.`);
    } else {
      await tx.category.deleteMany({ where: { id, tenantId } });
    }
  }
  if (applied.tenantBefore)
    await tx.tenant.update({ where: { id: tenantId }, data: applied.tenantBefore as never });
  if (applied.branchBefore) {
    // A JSON column that was empty goes back to SQL NULL (Prisma needs DbNull for that).
    const values = Object.fromEntries(
      Object.entries(applied.branchBefore.values).map(([k, v]) => [
        k,
        k === 'openingHours' && v === null ? Prisma.DbNull : v,
      ]),
    );
    await tx.branch.updateMany({
      where: { id: applied.branchBefore.id, tenantId },
      data: values as never,
    });
  }
  for (const id of applied.created.media) {
    const used =
      (await tx.product.count({ where: { imageMediaId: id } })) +
      (await tx.optionItem.count({ where: { imageMediaId: id } })) +
      (await tx.tenant.count({ where: { OR: [{ logoMediaId: id }, { coverMediaId: id }] } }));
    if (!used) await tx.mediaAsset.deleteMany({ where: { id, tenantId } });
  }
  return notes;
}
