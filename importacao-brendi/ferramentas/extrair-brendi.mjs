// Extrai o cardápio público de uma loja da Brendi para arquivos neutros (JSON + CSV) e baixa as
// fotos originais. Só lê o que a página pública já entrega a qualquer visitante: um GET da página
// (o cardápio vem embutido no HTML) e um GET por foto. Não faz login, não monta carrinho, não envia
// pedido e não carrega os scripts de análise da página.
//
// Uso:  node importacao-brendi/ferramentas/extrair-brendi.mjs [slug-da-loja] [--sem-imagens]
// Saída: importacao-brendi/dados/ e importacao-brendi/imagens/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const SLUG = args.find((a) => !a.startsWith('--')) ?? 'docehamburgueriaedoceria-ilicinea';
const WITH_IMAGES = !args.includes('--sem-imagens');
const PAGE_URL = `https://pedido.brendi.com.br/${SLUG}`;
const STORAGE = 'https://firebasestorage.googleapis.com/v0/b/brendi-app.appspot.com/o/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36';
const DATA_DIR = path.join(ROOT, 'dados');
const IMG_DIR = path.join(ROOT, 'imagens');
const WEEKDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// --- payload do Nuxt (formato "devalue": um array plano em que números apontam para índices) ---
export function decodeNuxtPayload(html) {
  const match = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('A página não trouxe o bloco __NUXT_DATA__ (o formato da Brendi mudou?).');
  const flat = JSON.parse(match[1]);
  const seen = new Map();
  const wrappers = new Set(['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef', 'NuxtError', 'Object']);
  const hydrate = (index) => {
    if (index < 0) return index === -2 ? null : undefined;
    if (seen.has(index)) return seen.get(index);
    const value = flat[index];
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const [tag] = value;
      if (typeof tag === 'string' && wrappers.has(tag)) return hydrate(value[1]);
      if (tag === 'Date') return value[1];
      if (tag === 'EmptyRef' || tag === 'EmptyShallowRef') return undefined;
      if (tag === 'Set') return value.slice(1).map(hydrate);
      if (tag === 'Map') {
        const out = {};
        for (let k = 1; k < value.length; k += 2) out[hydrate(value[k])] = hydrate(value[k + 1]);
        return out;
      }
      const out = [];
      seen.set(index, out);
      for (const item of value) out.push(hydrate(item));
      return out;
    }
    const out = {};
    seen.set(index, out);
    for (const [key, item] of Object.entries(value)) out[key] = hydrate(item);
    return out;
  };
  return hydrate(0);
}

const trim = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s ?? null);
const minutesToHHMM = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const storageUrl = (p) => (p ? (p.startsWith('http') ? p : STORAGE + encodeURIComponent(p) + '?alt=media') : null);
const idOf = (docPath) => docPath.split('/').pop();

// Como a Brendi mostra o preço na lista (observado na página): promoção "De X por Y"; "A partir de"
// quando algum adicional pago pode aumentar o valor; senão o preço fixo.
export function priceDisplay(product, groups) {
  if (product.currentPrice != null && product.currentPrice < product.price) return 'promocional';
  const paid = groups.some((g) => g.choices.some((c) => c.active && !c.missing && c.extraPrice > 0));
  return paid ? 'a_partir_de' : 'fixo';
}

export function normalize(root, capturedAt) {
  const menu = Object.entries(root.data).find(([k]) => k.startsWith('menu-') && !k.startsWith('menu-cuisines'))?.[1];
  if (!menu?.store) throw new Error('Cardápio não encontrado no payload.');
  const store = menu.store;
  const bestSellers = Object.values(root.data).find((v) => v && Array.isArray(v.products))?.products ?? [];
  const bestSellerIds = bestSellers.map((p) => p.id ?? p.$ref?.id).filter(Boolean);

  const published = Object.values(menu.productsByCategory).flat();
  const soldOut = menu.missingProducts ?? [];
  const allProducts = [...published, ...soldOut];
  const productById = new Map(allProducts.map((p) => [p.id, p]));

  const groupById = new Map();
  for (const p of allProducts) for (const g of p.customs ?? []) groupById.set(g.id, g);

  const order = (store.config?.menu?.orderedCategories ?? []).map(idOf);
  const categories = [...menu.categories]
    .sort((a, b) => (order.indexOf(a.id) + 1 || 999) - (order.indexOf(b.id) + 1 || 999))
    .map((c, i) => {
      const listed = c.productsPaths.map(idOf);
      const shown = (menu.productsByCategory[c.id] ?? []).map((p) => p.id);
      const soldOutHere = listed.filter((id) => productById.get(id)?.missing);
      return {
        idOrigem: c.id,
        nome: trim(c.name),
        ordem: i + 1,
        ativa: c.active,
        visivelNaLoja: shown.length + soldOutHere.length > 0,
        produtos: [...shown, ...soldOutHere],
        produtosNaoPublicados: listed.filter((id) => !productById.has(id)),
      };
    });
  const categoryOf = new Map();
  for (const c of categories) for (const id of c.produtos) if (!categoryOf.has(id)) categoryOf.set(id, c);

  const products = allProducts.map((p) => {
    const groups = (p.customs ?? []).filter(Boolean);
    const promo = p.currentPrice != null && p.currentPrice < p.price;
    const category = categoryOf.get(p.id) ?? categories.find((c) => p.categoryPath?.endsWith(c.idOrigem));
    const badges = [];
    if (p.label === 'new') badges.push('NOVIDADE');
    if ((p.classifications ?? []).includes('vegetarian')) badges.push('VEGETARIANO');
    return {
      idOrigem: p.id,
      slug: p.slug,
      nome: trim(p.name),
      descricao: trim(p.description) || null,
      categoriaIdOrigem: category?.idOrigem ?? null,
      categoriaNome: category?.nome ?? null,
      ordemNaCategoria: category ? category.produtos.indexOf(p.id) + 1 : null,
      // Preço cobrado hoje; na promoção, "de" é o preço cheio riscado.
      precoCentavos: promo ? p.currentPrice : p.price,
      precoDeCentavos: promo ? p.price : null,
      exibicaoPreco: priceDisplay(p, groups),
      esgotado: !!p.missing,
      ativo: p.active !== false,
      selos: badges,
      maisPedido: bestSellerIds.includes(p.id),
      ordemMaisPedido: bestSellerIds.includes(p.id) ? bestSellerIds.indexOf(p.id) + 1 : null,
      porcao: p.servingSize ?? null,
      grupos: groups.map((g) => g.id),
      imagem: p.picture ? { urlOrigem: storageUrl(p.picture), caminhoOrigem: p.picture } : null,
      imagensExtras: [p.secondPicture, p.thirdPicture, p.fourthPicture].filter(Boolean).map((x) => ({ urlOrigem: storageUrl(x) })),
    };
  });

  const groups = [...groupById.values()].map((g) => ({
    idOrigem: g.id,
    nome: trim(g.title),
    tipoOrigem: g.type,
    minimo: g.minChoices,
    maximo: g.maxChoices,
    obrigatorio: g.minChoices > 0,
    ativo: g.active !== false,
    opcoes: g.choices.map((c, i) => ({
      idOrigem: c.id,
      nome: trim(c.title),
      descricao: trim(c.description) || null,
      precoCentavos: c.extraPrice,
      maximoPorOpcao: c.maxChoices,
      ordem: i + 1,
      esgotado: !!c.missing,
      ativo: c.active !== false,
      imagem: c.picture ? { urlOrigem: storageUrl(c.picture), caminhoOrigem: c.picture } : null,
    })),
  }));

  const delivery = store.config?.delivery ?? {};
  const addr = store.address ?? {};
  const hours = Object.entries(store.workingHours ?? {})
    .flatMap(([day, spans]) => spans.map((s) => ({ weekday: WEEKDAYS[day], opens: minutesToHHMM(s.start), closes: minutesToHHMM(s.end) })))
    .sort((a, b) => a.weekday - b.weekday || a.opens.localeCompare(b.opens));
  const pay = store.payment ?? {};
  const banners = (menu.promotionalBanners ?? []).map((b) => ({ urlOrigem: b.image, produtoSlug: b.productSlug ?? null }));

  return {
    fonte: { plataforma: 'Brendi', url: PAGE_URL, capturadoEm: capturedAt, lojaIdOrigem: store.id },
    loja: {
      nome: trim(store.brand?.name) || trim(store.name),
      telefoneWhatsapp: store.phoneNumber ?? null,
      endereco: {
        rua: trim(addr.street), numero: trim(addr.number), complemento: trim(addr.complement) || null,
        bairro: trim(addr.neighborhood), cidade: trim(addr.city), uf: trim(addr.state), cep: trim(addr.zipcode),
        referencia: trim(addr.referencePoint) || null, fusoHorario: addr.timezone ?? null,
      },
      horarios: hours,
      pausasProgramadas: (store.scheduledBreak ?? []).map((b) => ({ inicio: b.start, fim: b.end, motivo: trim(b.name) })),
      pedidoMinimoCentavos: store.minimumOrder ?? null,
      entrega: {
        habilitada: !!delivery.deliveryEnabled,
        tipo: delivery.deliveryType ?? null,
        faixas: (store.delivery ?? []).map((f) => ({
          deMetros: f.minDistance, ateMetros: f.maxDistance, taxaCentavos: f.price, tempoMinMin: f.minTime, tempoMaxMin: f.maxTime,
        })),
        gratisAcimaDeCentavos: delivery.freeDelivery?.enabled ? delivery.freeDelivery.minPrice : null,
        regioes: store.deliveryRegions ?? [],
      },
      retirada: { habilitada: !!delivery.pickupOrder?.enabled, tempoMinMin: delivery.pickupOrder?.minTime ?? null, tempoMaxMin: delivery.pickupOrder?.maxTime ?? null },
      consumoNoLocal: { habilitado: !!delivery.onSiteConsumption?.enabled },
      agendamento: delivery.schedule
        ? { habilitado: !!delivery.schedule.enabled, diasMaximos: delivery.schedule.maxDaysToSchedule, horasMinimas: delivery.schedule.minHoursToSchedule, janelaMin: delivery.schedule.deliveryScheduleWindow }
        : null,
      pagamentos: {
        online: [pay.pix?.enabled && 'PIX', pay.onlineCredit?.enabled && 'CARTAO_CREDITO', pay.applePay?.enabled && 'APPLE_PAY', pay.googlePay?.enabled && 'GOOGLE_PAY'].filter(Boolean),
        naEntrega: [pay.money?.enabled && 'DINHEIRO', pay.credit?.enabled && 'CARTAO_CREDITO', pay.debit?.enabled && 'CARTAO_DEBITO', pay.va?.enabled && 'VALE_ALIMENTACAO', pay.vr?.enabled && 'VALE_REFEICAO'].filter(Boolean),
        bandeirasCartao: (pay.credit?.banners ?? []).filter((b) => b.active).map((b) => b.name),
      },
      fidelidadeAtiva: !!store.loyaltyProgram?.active,
      cashbackAtivo: !!store.cashback?.enabled,
      logo: store.logo ? { urlOrigem: storageUrl(store.logo), caminhoOrigem: store.logo } : null,
      capa: store.banner ? { urlOrigem: storageUrl(store.banner), caminhoOrigem: store.banner } : null,
      bannersPromocionais: banners,
    },
    categorias: categories,
    produtos: products,
    grupos: groups,
  };
}

// --- CSV (separador ";" e BOM, para abrir direto no Excel em português) ---
function toCsv(rows, columns) {
  const cell = (v) => {
    if (v == null) return '';
    const s = Array.isArray(v) ? v.join('|') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.join(';'), ...rows.map((r) => columns.map((c) => cell(r[c])).join(';'))].join('\r\n') + '\r\n';
}
const reais = (c) => (c == null ? null : (c / 100).toFixed(2).replace('.', ','));

function writeCsvs(menu) {
  const categoryRows = menu.categorias.map((c) => ({ ...c, qtdProdutos: c.produtos.length, qtdNaoPublicados: c.produtosNaoPublicados.length }));
  fs.writeFileSync(path.join(DATA_DIR, 'categorias.csv'), toCsv(categoryRows, ['idOrigem', 'nome', 'ordem', 'ativa', 'visivelNaLoja', 'qtdProdutos', 'qtdNaoPublicados']));
  const productRows = menu.produtos.map((p) => ({
    ...p, preco: reais(p.precoCentavos), precoDe: reais(p.precoDeCentavos), imagemUrl: p.imagem?.urlOrigem, imagemArquivo: p.imagem?.arquivo, grupos: p.grupos,
  }));
  fs.writeFileSync(path.join(DATA_DIR, 'produtos.csv'), toCsv(productRows, ['idOrigem', 'categoriaNome', 'ordemNaCategoria', 'nome', 'descricao', 'preco', 'precoDe', 'exibicaoPreco', 'esgotado', 'selos', 'maisPedido', 'grupos', 'imagemArquivo', 'imagemUrl']));
  const optionRows = menu.grupos.flatMap((g) => g.opcoes.map((o) => ({
    grupoIdOrigem: g.idOrigem, grupoNome: g.nome, grupoMinimo: g.minimo, grupoMaximo: g.maximo, ...o, preco: reais(o.precoCentavos), imagemArquivo: o.imagem?.arquivo,
  })));
  fs.writeFileSync(path.join(DATA_DIR, 'adicionais.csv'), toCsv(optionRows, ['grupoIdOrigem', 'grupoNome', 'grupoMinimo', 'grupoMaximo', 'idOrigem', 'ordem', 'nome', 'descricao', 'preco', 'maximoPorOpcao', 'esgotado', 'imagemArquivo']));
  const linkRows = menu.produtos.flatMap((p) => p.grupos.map((g, i) => ({ produtoIdOrigem: p.idOrigem, produtoNome: p.nome, grupoIdOrigem: g, grupoNome: menu.grupos.find((x) => x.idOrigem === g)?.nome, ordem: i + 1 })));
  fs.writeFileSync(path.join(DATA_DIR, 'produto-adicionais.csv'), toCsv(linkRows, ['produtoIdOrigem', 'produtoNome', 'grupoIdOrigem', 'grupoNome', 'ordem']));
  const imageRows = [];
  const pushImage = (tipo, dono, img) => img && imageRows.push({ tipo, dono, arquivo: img.arquivo ?? null, sha256: img.sha256 ?? null, bytes: img.bytes ?? null, tipoConteudo: img.tipoConteudo ?? null, urlOrigem: img.urlOrigem });
  pushImage('logo', menu.loja.nome, menu.loja.logo);
  pushImage('capa', menu.loja.nome, menu.loja.capa);
  menu.loja.bannersPromocionais.forEach((b, i) => pushImage('banner', `banner ${i + 1}`, b));
  menu.produtos.forEach((p) => pushImage('produto', p.nome, p.imagem));
  menu.grupos.forEach((g) => g.opcoes.forEach((o) => pushImage('adicional', `${g.nome} / ${o.nome}`, o.imagem)));
  fs.writeFileSync(path.join(DATA_DIR, 'imagens.csv'), toCsv(imageRows, ['tipo', 'dono', 'arquivo', 'tipoConteudo', 'bytes', 'sha256', 'urlOrigem']));
}

// --- fotos: originais do armazenamento público, uma por vez ---
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
async function download(img, baseName) {
  if (!img?.urlOrigem) return;
  const res = await fetch(img.urlOrigem, { headers: { 'user-agent': UA } });
  if (!res.ok) { img.erro = `HTTP ${res.status}`; return; }
  const type = (res.headers.get('content-type') ?? '').split(';')[0];
  if (!EXT[type]) { img.erro = `tipo não suportado: ${type}`; return; }
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = `${baseName}.${EXT[type]}`;
  fs.writeFileSync(path.join(IMG_DIR, file), bytes);
  Object.assign(img, { arquivo: file, tipoConteudo: type, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const capturedAt = new Date().toISOString();
  const res = await fetch(PAGE_URL, { headers: { 'user-agent': UA, 'accept-language': 'pt-BR' } });
  if (!res.ok) throw new Error(`A página respondeu HTTP ${res.status}.`);
  const html = await res.text();
  const menu = normalize(decodeNuxtPayload(html), capturedAt);

  if (WITH_IMAGES) {
    await download(menu.loja.logo, 'loja-logo');
    await download(menu.loja.capa, 'loja-capa');
    for (const [i, b] of menu.loja.bannersPromocionais.entries()) await download(b, `banner-${i + 1}`);
    for (const p of menu.produtos) await download(p.imagem, `produto-${p.idOrigem}`);
    for (const g of menu.grupos) for (const o of g.opcoes) await download(o.imagem, `adicional-${o.idOrigem}`);
  }

  fs.writeFileSync(path.join(DATA_DIR, 'cardapio.json'), JSON.stringify(menu, null, 2) + '\n');
  writeCsvs(menu);
  const images = [menu.loja.logo, menu.loja.capa, ...menu.loja.bannersPromocionais, ...menu.produtos.map((p) => p.imagem), ...menu.grupos.flatMap((g) => g.opcoes.map((o) => o.imagem))].filter(Boolean);
  console.log(JSON.stringify({
    capturadoEm: capturedAt,
    categorias: menu.categorias.length,
    categoriasVisiveis: menu.categorias.filter((c) => c.visivelNaLoja).length,
    produtos: menu.produtos.length,
    produtosEsgotados: menu.produtos.filter((p) => p.esgotado).length,
    produtosNaoPublicados: new Set(menu.categorias.flatMap((c) => c.produtosNaoPublicados)).size,
    grupos: menu.grupos.length,
    opcoes: menu.grupos.reduce((s, g) => s + g.opcoes.length, 0),
    imagens: images.length,
    imagensBaixadas: images.filter((i) => i.arquivo).length,
    imagensComErro: images.filter((i) => i.erro).map((i) => `${i.urlOrigem}: ${i.erro}`),
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
