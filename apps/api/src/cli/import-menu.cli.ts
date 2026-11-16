import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  CurrentCatalog,
  Fingerprints,
  ImportPlan,
  PlanRow,
  STORE_KEY,
  buildPlan,
  catalogFingerprints,
  countActions,
  fingerprint,
  hasConflicts,
} from '../modules/menu-import/menu-import-plan';
import { SourceMenu, validateSource } from '../modules/menu-import/menu-import-source';
import {
  AppliedChanges,
  StoreUpdate,
  applyPlan,
  loadImages,
  readCatalog,
  undoApplied,
} from '../modules/menu-import/menu-import.runner';
import { normalizeOpeningHours, openingHoursProblem } from '../modules/tenants/opening-hours';
import { normalizePhone, normalizeState, normalizeZipCode } from '../modules/tenants/profile-input';
import { describeDatabaseUrl, parseEnvFile } from './provision-tenant.cli';

// Imports a menu file (importacao-brendi/dados/cardapio.json) into ONE existing restaurant
// (docs/IMPORTACAO_CARDAPIO.md). Without --aplicar it only shows what it would do (dry run) and
// writes the plan to a report; nothing is written to the database. Applying needs the database
// AND the restaurant confirmed by name on the command line, runs in one transaction, and the
// report it writes can undo the run (--desfazer). It never creates or deletes restaurants, never
// touches stock, recipes, prices of orders already taken, or anything of another restaurant.
//
// Exit code: 0 done (or dry run ok); 1 refused (invalid file, conflicts, error); 2 the command or
// the environment is wrong and nothing was attempted.

export const USAGE = [
  'Uso: menu:import --arquivo <cardapio.json> --restaurante <slug> [opções]',
  '',
  '  --arquivo <caminho>             Arquivo do cardápio extraído (obrigatório, exceto com --desfazer)',
  '  --imagens <pasta>               Pasta das fotos (padrão: ../imagens ao lado da pasta do arquivo)',
  '  --restaurante <slug>            Restaurante de destino (obrigatório; já precisa existir)',
  '  --prefixo <nome>                Prefixo da identidade de origem (padrão: a plataforma da fonte, ex.: brendi)',
  '  --adotar-por-nome               Atualiza itens criados à mão com o mesmo nome (senão é conflito)',
  '  --sobrescrever-edicoes          A fonte vence também nos itens editados ou excluídos no painel',
  '                                  (sem isto, esses itens são mantidos como estão)',
  '  --incluir-loja                  Também logo, capa, horários, WhatsApp, endereço, taxa e pedido mínimo',
  '  --cor-marca <#RRGGBB>           Cor da marca no cardápio público',
  '  --relatorio <caminho>           Onde gravar o relatório (padrão: pasta atual)',
  '  --aplicar                       Grava no banco (sem isto: só simulação)',
  '  --confirmar-banco <nome>        Obrigatório com --aplicar: nome do banco alvo',
  '  --confirmar-restaurante <slug>  Obrigatório com --aplicar: slug do restaurante, de novo',
  '  --desfazer <relatorio.json>     Desfaz uma importação aplicada (também exige --aplicar e confirmações)',
  '  --help                          Mostra esta ajuda',
].join('\n');

export class UsageError extends Error {}

export interface ImportArgs {
  file?: string;
  images?: string;
  tenant?: string;
  prefix?: string;
  adoptByName: boolean;
  overwriteEdits: boolean;
  includeStore: boolean;
  brandColor?: string;
  report?: string;
  apply: boolean;
  confirmDatabase?: string;
  confirmTenant?: string;
  undo?: string;
  help: boolean;
}

const VALUE_FLAGS: Record<string, keyof ImportArgs> = {
  arquivo: 'file',
  imagens: 'images',
  restaurante: 'tenant',
  prefixo: 'prefix',
  'cor-marca': 'brandColor',
  relatorio: 'report',
  'confirmar-banco': 'confirmDatabase',
  'confirmar-restaurante': 'confirmTenant',
  desfazer: 'undo',
};
const BOOLEAN_FLAGS: Record<string, keyof ImportArgs> = {
  'adotar-por-nome': 'adoptByName',
  'sobrescrever-edicoes': 'overwriteEdits',
  'incluir-loja': 'includeStore',
  aplicar: 'apply',
  help: 'help',
};

export function parseImportArgs(argv: string[]): ImportArgs {
  const args: ImportArgs = {
    adoptByName: false,
    overwriteEdits: false,
    includeStore: false,
    apply: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) throw new UsageError(`Argumento não reconhecido: "${raw}".`);
    const eq = raw.indexOf('=');
    const name = (eq === -1 ? raw.slice(2) : raw.slice(2, eq)).toLowerCase();
    if (BOOLEAN_FLAGS[name]) {
      if (eq !== -1) throw new UsageError(`--${name} não recebe valor.`);
      (args as unknown as Record<string, boolean>)[BOOLEAN_FLAGS[name]] = true;
      continue;
    }
    const key = VALUE_FLAGS[name];
    if (!key) throw new UsageError(`Opção desconhecida: --${name}.`);
    const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
    if (value === undefined || value.startsWith('--'))
      throw new UsageError(`--${name} precisa de um valor.`);
    (args as unknown as Record<string, string>)[key] = value;
  }
  if (args.help) return args;
  if (!args.tenant)
    throw new UsageError('Informe o restaurante de destino com --restaurante <slug>.');
  if (!args.file && !args.undo)
    throw new UsageError('Informe o arquivo do cardápio com --arquivo.');
  if (args.brandColor && !/^#[0-9a-fA-F]{6}$/.test(args.brandColor))
    throw new UsageError('--cor-marca deve ser #RRGGBB.');
  if (args.prefix && !/^[a-z0-9-]{2,20}$/.test(args.prefix))
    throw new UsageError('--prefixo: letras minúsculas, números e hífen.');
  return args;
}

// Branch fields the source can fill (--incluir-loja), normalized by the same rules as the
// restaurant profile screen. A value that does not pass them is left out, with a warning.
export function storeBranchValues(menu: SourceMenu, warnings: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const store = menu.loja;
  if (store.horarios?.length) {
    const problem = openingHoursProblem(store.horarios);
    if (problem) warnings.push(`Horários não importados: ${problem}`);
    else values.openingHours = normalizeOpeningHours(store.horarios);
  }
  if (store.telefoneWhatsapp) {
    const phone = normalizePhone(store.telefoneWhatsapp);
    if (phone) values.whatsapp = phone;
    else warnings.push('WhatsApp não importado: número em formato inesperado.');
  }
  const a = store.endereco;
  if (a) {
    if (a.rua) values.address = a.rua;
    if (a.numero) values.number = a.numero;
    if (a.complemento) values.complement = a.complemento;
    if (a.bairro) values.neighborhood = a.bairro;
    if (a.cidade) values.city = a.cidade;
    const state = a.uf ? normalizeState(a.uf) : null;
    if (state) values.state = state;
    const zip = a.cep ? normalizeZipCode(a.cep) : null;
    if (zip) values.zipCode = zip;
  }
  if (store.entrega) {
    values.deliveryEnabled = store.entrega.habilitada;
    const fees = [...new Set(store.entrega.faixas.map((f) => f.taxaCentavos))];
    if (fees.length === 1) values.deliveryFeeCents = fees[0];
    else if (fees.length > 1) {
      values.deliveryFeeCents = Math.max(...fees);
      warnings.push(
        `Taxa de entrega por distância (${fees.join(', ')} centavos) não existe no sistema: usada a maior, fixa.`,
      );
    }
  }
  if (store.entrega?.gratisAcimaDeCentavos)
    values.deliveryFreeAboveCents = store.entrega.gratisAcimaDeCentavos;
  if (store.pedidoMinimoCentavos != null) values.deliveryMinOrderCents = store.pedidoMinimoCentavos;
  return values;
}

// Which of those values differ from the branch as it is, so a rerun reports "sem mudança"
// for the store like it does for the catalog. JSON is compared with sorted keys: PostgreSQL
// returns jsonb with its own key order.
const canonical = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : (v ?? null);

export function changedStoreFields(
  values: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  return Object.keys(values).filter(
    (k) => JSON.stringify(canonical(values[k])) !== JSON.stringify(canonical(current[k])),
  );
}

// What --incluir-loja manages, as it is now: logo, cover, brand color and the branch fields the
// source fills. Its fingerprint tells whether the panel changed any of it since the last import.
export interface StoreState {
  logoSha: string | null;
  coverSha: string | null;
  brandColor: string | null;
  branch: Record<string, unknown>;
}

export function storeFingerprint(state: StoreState): string {
  return fingerprint(canonical(state));
}

async function readStoreState(
  db: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  branchId: string | undefined,
  branchFields: string[],
): Promise<StoreState> {
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: {
      brandColor: true,
      logoMedia: { select: { sha256: true } },
      coverMedia: { select: { sha256: true } },
    },
  });
  const branch =
    branchId && branchFields.length
      ? ((await db.branch.findUniqueOrThrow({
          where: { id: branchId },
          select: Object.fromEntries(branchFields.map((k) => [k, true])),
        })) as Record<string, unknown>)
      : {};
  return {
    logoSha: tenant.logoMedia?.sha256 ?? null,
    coverSha: tenant.coverMedia?.sha256 ?? null,
    brandColor: tenant.brandColor,
    branch,
  };
}

// The fingerprints left by the last applied import of this prefix (its MENU_IMPORTED entry, or the
// MENU_IMPORT_UNDONE entry that undid it). null when there is none, or when the last one was made
// before the fingerprints existed: then nothing can tell which rows the panel changed.
export async function readBaseline(
  db: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  prefix: string,
): Promise<Fingerprints | null> {
  const entries = await db.auditLog.findMany({
    where: { tenantId, action: { in: ['MENU_IMPORTED', 'MENU_IMPORT_UNDONE'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { afterData: true },
  });
  for (const entry of entries) {
    const data = (entry.afterData ?? {}) as Record<string, unknown>;
    if (data.prefix === undefined) return null;
    if (data.prefix !== prefix) continue;
    const prints = data.fingerprints;
    return prints && typeof prints === 'object' ? (prints as Fingerprints) : null;
  }
  return null;
}

export interface ImportCliDeps {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  out: (line: string) => void;
  err: (line: string) => void;
  newClient: (databaseUrl: string) => PrismaClient;
  now: () => Date;
  actor: string;
}

const label: Record<string, string> = {
  create: 'criar',
  update: 'atualizar',
  unchanged: 'sem mudança',
  conflict: 'CONFLITO',
  adopt: 'adotar',
  kept: 'MANTIDO',
};
const keptLabel: Record<string, string> = {
  edited: 'editado no painel',
  deleted: 'excluído no painel, não será recriado',
  'parent-deleted': 'categoria ou grupo excluído no painel',
};

function describeRows(title: string, rows: PlanRow<unknown>[], out: (line: string) => void) {
  for (const r of rows.filter((x) => x.action !== 'unchanged')) {
    const changes = r.changes.length ? ` (${r.changes.map((c) => c.field).join(', ')})` : '';
    const why = r.keptReason
      ? ` [${keptLabel[r.keptReason]}; a fonte mudaria${changes || ': nada'}]`
      : '';
    out(`  ${title} ${label[r.action]}: ${r.name}${why || changes}`);
  }
}

export async function runImportCli(deps: ImportCliDeps): Promise<number> {
  const { out, err } = deps;
  let args: ImportArgs;
  try {
    args = parseImportArgs(deps.argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(error.message);
    err('Use --help para ver as opções. Nada foi feito.');
    return 2;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }

  const envFile = join(deps.cwd, '.env');
  const fileVars =
    !deps.env.DATABASE_URL && existsSync(envFile)
      ? parseEnvFile(readFileSync(envFile, 'utf8'))
      : {};
  const databaseUrl = deps.env.DATABASE_URL || fileVars.DATABASE_URL;
  const target = describeDatabaseUrl(databaseUrl);
  if (!databaseUrl || !target) {
    err('DATABASE_URL não está definido ou não é uma URL PostgreSQL. Nada foi feito.');
    return 2;
  }
  out(
    `Importação de cardápio — ${args.apply ? 'APLICAR' : 'SIMULAÇÃO (nada será gravado)'}${args.undo ? ' — DESFAZER' : ''}`,
  );
  out(`Banco alvo: ${target.database} em ${target.host}:${target.port}`);
  if (
    args.apply &&
    (args.confirmDatabase !== target.database || args.confirmTenant !== args.tenant)
  ) {
    err(
      'Para gravar, confirme o banco e o restaurante: --confirmar-banco <nome do banco> --confirmar-restaurante <slug>.',
    );
    err(`(banco alvo: "${target.database}", restaurante: "${args.tenant}"). Nada foi feito.`);
    return 2;
  }

  const prisma = deps.newClient(databaseUrl);
  try {
    const [server] = await prisma.$queryRaw<
      { database: string }[]
    >`SELECT current_database() AS database`;
    if (args.apply && server.database !== args.confirmDatabase) {
      err(
        `O servidor respondeu pelo banco "${server.database}", não "${args.confirmDatabase}". Nada foi feito.`,
      );
      return 2;
    }
    const tenant = await prisma.tenant.findUnique({
      where: { slug: args.tenant! },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant) {
      err(
        `Restaurante "${args.tenant}" não existe neste banco. A importação não cria restaurantes. Nada foi feito.`,
      );
      return 1;
    }
    out(`Restaurante: ${tenant.name} (${tenant.slug})`);

    if (args.undo) return await runUndo(prisma, args, tenant.id, deps);

    const filePath = resolve(deps.cwd, args.file!);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      err(`Não foi possível ler o arquivo ${filePath}. Nada foi feito.`);
      return 1;
    }
    const { menu, errors, warnings } = validateSource(raw);
    if (!menu) {
      err(`O arquivo tem ${errors.length} erro(s); nada foi importado:`);
      for (const e of errors) err(`  - ${e}`);
      return 1;
    }
    const imagesDir = args.images
      ? resolve(deps.cwd, args.images)
      : resolve(dirname(filePath), '..', 'imagens');
    const { images, warnings: imageWarnings } = loadImages(
      menu,
      existsSync(imagesDir) ? imagesDir : null,
    );
    if (!existsSync(imagesDir))
      warnings.push(`Pasta de imagens não encontrada (${imagesDir}): importação sem fotos.`);
    warnings.push(...imageWarnings);

    const prefix = args.prefix ?? menu.fonte.plataforma.toLowerCase().replace(/[^a-z0-9-]/g, '');
    const current: CurrentCatalog = await readCatalog(prisma, tenant.id);
    // Edits made in the panel since the last import are kept, unless --sobrescrever-edicoes.
    const baseline = await readBaseline(prisma, tenant.id, prefix);
    const importedBefore = [
      ...current.categories,
      ...current.groups,
      ...current.options,
      ...current.products,
    ].some((r) => r.externalId?.startsWith(`${prefix}:`));
    const unknownEdits = importedBefore && baseline === null && !args.overwriteEdits;
    const plan = buildPlan(menu, current, {
      prefix,
      adoptByName: args.adoptByName,
      baseline,
      overwriteEdits: args.overwriteEdits,
    });
    const branchId = args.includeStore
      ? (
          await prisma.branch.findFirst({
            where: { tenantId: tenant.id, status: 'ACTIVE' },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          })
        )?.id
      : undefined;
    let store: StoreUpdate = {
      identity: args.includeStore,
      brandColor: args.brandColor?.toUpperCase() ?? null,
      branch:
        args.includeStore && branchId
          ? { branchId, values: storeBranchValues(menu, warnings) }
          : null,
    };
    const storeRequested = store.identity || !!store.brandColor;
    const storeFields = Object.keys(store.branch?.values ?? {});
    let storeKept = false;
    if (storeRequested && baseline?.[STORE_KEY] !== undefined && !args.overwriteEdits) {
      const now = storeFingerprint(await readStoreState(prisma, tenant.id, branchId, storeFields));
      if (now !== baseline[STORE_KEY]) {
        storeKept = true;
        store = { identity: false, brandColor: null, branch: null };
      }
    }

    const counts = countActions(plan);
    out(
      `Fonte: ${menu.fonte.plataforma} — ${menu.fonte.url} (capturado em ${menu.fonte.capturadoEm})`,
    );
    out(`Imagens válidas: ${images.size}`);
    for (const [kind, c] of Object.entries(counts)) {
      out(
        `  ${kind.padEnd(11)} criar ${c.create}, atualizar ${c.update}, sem mudança ${c.unchanged}, adotar ${c.adopt}, conflitos ${c.conflict}, mantidos ${c.kept}`,
      );
    }
    describeRows('categoria', plan.categories, out);
    describeRows('grupo', plan.groups, out);
    describeRows('adicional', plan.options, out);
    describeRows('produto', plan.products, out);
    if (store.branch) {
      const fields = Object.keys(store.branch.values);
      const branchNow = await prisma.branch.findUniqueOrThrow({
        where: { id: store.branch.branchId },
        select: Object.fromEntries(fields.map((k) => [k, true])),
      });
      const changed = changedStoreFields(store.branch.values, branchNow as Record<string, unknown>);
      out(
        changed.length
          ? `  loja: alterar ${changed.join(', ')}; sem mudança ${fields.length - changed.length}`
          : `  loja: sem mudança (${fields.length} campos)`,
      );
    }
    if (storeKept)
      out(
        '  loja MANTIDA: logo, capa, cor ou dados da unidade foram mudados no painel (use --sobrescrever-edicoes para trocar).',
      );
    if (store.identity) out('  loja: logo e capa');
    if (store.brandColor) out(`  loja: cor da marca ${store.brandColor}`);
    for (const m of plan.missingFromSource)
      out(`  aviso: ${m.kind} "${m.name}" foi importado antes e não está mais na fonte (mantido).`);
    for (const s of plan.skipped) out(`  aviso: ${s}`);
    for (const w of warnings) out(`  aviso: ${w}`);
    if (unknownEdits) {
      out(
        '  ATENÇÃO: este restaurante já recebeu uma importação, mas não há a referência que mostra o que',
      );
      out(
        '  foi mudado no painel desde então (importação anterior à proteção de edições). Gravar agora',
      );
      out(
        '  poderia desfazer edições do painel sem aviso: só com --sobrescrever-edicoes (a fonte vence em tudo).',
      );
    }

    const report = {
      geradoEm: deps.now().toISOString(),
      modo: args.apply ? 'aplicar' : 'simulacao',
      operador: deps.actor,
      banco: target.database,
      restaurante: { id: tenant.id, slug: tenant.slug, nome: tenant.name },
      fonte: menu.fonte,
      prefixo: prefix,
      contagem: counts,
      protecao: {
        referencia: baseline ? 'última importação' : 'nenhuma',
        sobrescreverEdicoes: args.overwriteEdits,
        lojaMantida: storeKept,
      },
      plano: summarizePlan(plan),
      avisos: [...plan.skipped, ...warnings],
      aplicado: null as AppliedChanges | null,
    };

    if (hasConflicts(plan)) {
      err(
        'Há itens criados à mão com o mesmo nome (CONFLITO). Nada será gravado enquanto houver conflitos:',
      );
      err('renomeie-os, ou rode com --adotar-por-nome para atualizá-los a partir da fonte.');
      writeReport(report, args, deps, tenant.slug);
      return 1;
    }
    if (unknownEdits && args.apply) {
      err(
        'Sem referência da última importação: nada foi gravado. Confira a simulação e, se a fonte deve',
      );
      err('vencer em tudo, rode de novo com --sobrescrever-edicoes.');
      writeReport(report, args, deps, tenant.slug);
      return 1;
    }
    if (!args.apply) {
      writeReport(report, args, deps, tenant.slug);
      out(
        'Simulação concluída. Nada foi gravado. Para gravar: --aplicar --confirmar-banco <banco> --confirmar-restaurante <slug>.',
      );
      return 0;
    }

    const applied = await prisma.$transaction(
      async (tx) => {
        const result = await applyPlan(tx, tenant.id, menu, plan, images, store);
        result.baselineBefore = baseline;
        // The new baseline: what this run left. A row kept as the panel left it keeps its old
        // fingerprint, so it stays protected next time too.
        const prints = catalogFingerprints(await readCatalog(tx, tenant.id), prefix);
        for (const row of [...plan.categories, ...plan.groups, ...plan.options, ...plan.products]) {
          if (row.action !== 'kept') continue;
          if (baseline?.[row.externalId] !== undefined)
            prints[row.externalId] = baseline[row.externalId];
          else delete prints[row.externalId];
        }
        if (storeRequested && !storeKept) {
          prints[STORE_KEY] = storeFingerprint(
            await readStoreState(tx, tenant.id, branchId, storeFields),
          );
        } else if (baseline?.[STORE_KEY] !== undefined) {
          prints[STORE_KEY] = baseline[STORE_KEY];
        }
        await tx.auditLog.create({
          data: {
            tenantId: tenant.id,
            action: 'MENU_IMPORTED',
            entity: 'Tenant',
            entityId: tenant.id,
            afterData: {
              source: menu.fonte.url,
              capturedAt: menu.fonte.capturadoEm,
              operator: deps.actor,
              counts,
              created: Object.fromEntries(
                Object.entries(result.created).map(([k, v]) => [k, v.length]),
              ),
              updated: result.updated.length,
              prefix,
              fingerprints: prints,
            } as Prisma.InputJsonValue,
          },
        });
        return result;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    report.aplicado = applied;
    const path = writeReport(report, args, deps, tenant.slug);
    out(`Importação aplicada. Relatório (guarde-o para poder desfazer): ${path}`);
    return 0;
  } catch (error) {
    err(
      `Erro durante a importação; a transação foi desfeita e nada foi gravado. (${(error as Error).message.split('\n')[0]})`,
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

async function runUndo(
  prisma: PrismaClient,
  args: ImportArgs,
  tenantId: string,
  deps: ImportCliDeps,
): Promise<number> {
  const { out, err } = deps;
  const report = JSON.parse(readFileSync(resolve(deps.cwd, args.undo!), 'utf8')) as {
    aplicado?: AppliedChanges;
    prefixo?: string;
  };
  const applied = report.aplicado;
  if (!applied || applied.tenantId !== tenantId) {
    err('Este relatório não é de uma importação aplicada neste restaurante. Nada foi feito.');
    return 1;
  }
  out(
    `Desfazer: ${applied.created.products.length} produtos, ${applied.created.categories.length} categorias, ` +
      `${applied.created.groups.length} grupos e ${applied.created.options.length} adicionais criados; ${applied.updated.length} itens atualizados.`,
  );
  if (!args.apply) {
    out(
      'Simulação: nada foi desfeito. Para desfazer: --aplicar --confirmar-banco <banco> --confirmar-restaurante <slug>.',
    );
    return 0;
  }
  const notes = await prisma.$transaction((tx) => undoApplied(tx, applied), {
    timeout: 120_000,
    maxWait: 10_000,
  });
  await prisma.auditLog.create({
    data: {
      tenantId,
      action: 'MENU_IMPORT_UNDONE',
      entity: 'Tenant',
      entityId: tenantId,
      // The protection goes back to what it was before the undone run.
      afterData: {
        operator: deps.actor,
        notes,
        ...(report.prefixo
          ? { prefix: report.prefixo, fingerprints: applied.baselineBefore ?? null }
          : {}),
      } as Prisma.InputJsonValue,
    },
  });
  for (const n of notes) out(`  ${n}`);
  out('Importação desfeita.');
  return 0;
}

function summarizePlan(plan: ImportPlan) {
  const rows = (list: PlanRow<unknown>[]) =>
    list.map((r) => ({
      acao: r.action,
      ...(r.keptReason ? { motivo: r.keptReason } : {}),
      idExterno: r.externalId,
      nome: r.name,
      idExistente: r.existingId,
      mudancas: r.changes,
    }));
  return {
    categorias: rows(plan.categories),
    grupos: rows(plan.groups),
    adicionais: rows(plan.options),
    produtos: rows(plan.products),
    ausentesNaFonte: plan.missingFromSource,
  };
}

function writeReport(report: object, args: ImportArgs, deps: ImportCliDeps, slug: string): string {
  const stamp = deps.now().toISOString().replace(/[:.]/g, '-');
  const path = resolve(deps.cwd, args.report ?? `importacao-${slug}-${stamp}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  deps.out(`Relatório: ${path}`);
  return path;
}
