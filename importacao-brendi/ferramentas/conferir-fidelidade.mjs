// Confere o cardápio importado com o arquivo extraído: preço, preço "de", esgotado, categoria,
// descrição, foto, destaque e adicionais de cada produto, as regras dos grupos e a contagem.
// Opcional: confere também o preço que a página da Brendi exibe (texto salvo da página).
//
// Uso: node importacao-brendi/ferramentas/conferir-fidelidade.mjs <url da API> <slug> [texto-da-pagina.txt]
//   ex.: node importacao-brendi/ferramentas/conferir-fidelidade.mjs http://127.0.0.1:4700/v1 doce-importacao
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [api, slug, pageText] = process.argv.slice(2);
if (!api || !slug) {
  console.error('Uso: conferir-fidelidade.mjs <url da API> <slug> [texto-da-pagina.txt]');
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados', 'cardapio.json'), 'utf8'));
const saas = await (await fetch(`${api.replace(/\/+$/, '')}/public/menu/${slug}`)).json();
const brendiText = pageText ? fs.readFileSync(pageText, 'utf8') : null;
const brl = (c) => 'R$ ' + (c / 100).toFixed(2).replace('.', ',');
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const problems = [];
let checks = 0;
const expect = (label, a, b) => {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${label}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
};

const saasProducts = saas.categories.flatMap((c) => c.products.map((p) => ({ ...p, category: c.name })));
const saasByName = new Map(saasProducts.map((p) => [clean(p.name), p]));
const groupsById = new Map(src.grupos.map((g) => [g.idOrigem, g]));
for (const p of src.produtos) {
  const s = saasByName.get(clean(p.nome));
  checks++;
  if (!s) {
    problems.push(`ausente no SaaS: ${p.nome}`);
    continue;
  }
  expect(`${p.nome} preço`, Math.round(s.price * 100), p.precoCentavos);
  expect(`${p.nome} preço "de"`, s.compareAtPrice == null ? null : Math.round(s.compareAtPrice * 100), p.precoDeCentavos);
  expect(`${p.nome} esgotado`, s.soldOut, p.esgotado);
  expect(`${p.nome} categoria`, s.category, p.categoriaNome);
  expect(`${p.nome} descrição`, s.description, p.descricao ? clean(p.descricao) : null);
  expect(`${p.nome} foto`, !!s.imageUrl, !!p.imagem);
  expect(`${p.nome} destaque`, s.featured, p.maisPedido);
  // A página só oferece opções ativas e não esgotadas.
  const offered = p.grupos.flatMap((g) =>
    groupsById
      .get(g)
      .opcoes.filter((o) => o.ativo && !o.esgotado)
      .map((o) => `${groupsById.get(g).nome}/${clean(o.nome)}/${o.precoCentavos}/${o.maximoPorOpcao}`),
  );
  const saasOptions = (s.optionGroups ?? []).flatMap((g) =>
    g.options.map((o) => `${g.name}/${o.name}/${Math.round(o.price * 100)}/${o.maxQuantity}`),
  );
  expect(`${p.nome} adicionais`, saasOptions, offered);
  if (brendiText) {
    const label =
      p.exibicaoPreco === 'promocional'
        ? `De ${brl(p.precoDeCentavos)} por ${brl(p.precoCentavos)}`
        : p.exibicaoPreco === 'a_partir_de'
          ? `A partir deR$ ${(p.precoCentavos / 100).toFixed(2).replace('.', ',')}`
          : brl(p.precoCentavos);
    checks++;
    if (!brendiText.includes(label)) problems.push(`${p.nome}: a página não mostra "${label}"`);
  }
}
const rules = (list) => [...new Set(list)].sort();
expect(
  'regras dos grupos',
  rules(saasProducts.flatMap((p) => (p.optionGroups ?? []).map((g) => `${g.name} ${g.minSelect}-${g.maxSelect}`))),
  rules(src.grupos.map((g) => `${g.nome} ${g.minimo}-${g.maximo}`)),
);
expect('quantidade de produtos', saasProducts.length, src.produtos.length);
// Ordem: categorias com produtos publicados, na ordem da loja; produtos na ordem da categoria.
const productsById = new Map(src.produtos.map((p) => [p.idOrigem, p]));
const srcCategories = [...src.categorias]
  .sort((a, b) => a.ordem - b.ordem)
  .map((c) => ({ nome: c.nome, produtos: c.produtos.filter((id) => productsById.has(id)) }))
  .filter((c) => c.produtos.length > 0);
expect(
  'ordem das categorias',
  saas.categories.map((c) => c.name),
  srcCategories.map((c) => c.nome),
);
for (const c of srcCategories) {
  expect(
    `ordem dos produtos em ${c.nome}`,
    (saas.categories.find((x) => x.name === c.nome)?.products ?? []).map((p) => clean(p.name)),
    c.produtos
      .map((id) => productsById.get(id))
      .sort((a, b) => a.ordemNaCategoria - b.ordemNaCategoria)
      .map((p) => clean(p.nome)),
  );
}
// Contagens resumidas.
expect('esgotados', saasProducts.filter((p) => p.soldOut).length, src.produtos.filter((p) => p.esgotado).length);
expect(
  'promoções (preço "de")',
  saasProducts.filter((p) => p.compareAtPrice != null).length,
  src.produtos.filter((p) => p.precoDeCentavos != null).length,
);
expect('produtos com foto', saasProducts.filter((p) => p.imageUrl).length, src.produtos.filter((p) => p.imagem).length);
const offeredOptions = new Set(
  saasProducts.flatMap((p) => (p.optionGroups ?? []).flatMap((g) => g.options.map((o) => o.id))),
);
expect(
  'adicionais oferecidos',
  offeredOptions.size,
  src.grupos.flatMap((g) => g.opcoes.filter((o) => o.ativo && !o.esgotado)).length,
);
// Loja (só quando importada com --incluir-loja).
const entrega = src.loja.entrega;
expect('entrega grátis a partir de', Math.round((saas.delivery.freeAbove ?? 0) * 100), entrega.gratisAcimaDeCentavos);
expect('pedido mínimo', Math.round((saas.delivery.minOrder ?? 0) * 100), src.loja.pedidoMinimoCentavos);
expect('taxa de entrega', Math.round(saas.delivery.fee * 100), entrega.faixas[0].taxaCentavos);
expect('logo', !!saas.restaurant.logoUrl, !!src.loja.logo);
expect('capa', !!saas.restaurant.coverUrl, !!src.loja.capa);
console.log(`fidelidade: ${checks - problems.length}/${checks} verificações`);
for (const x of problems) console.log(' -', x);
process.exitCode = problems.length ? 1 : 0;
