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
console.log(`fidelidade: ${checks - problems.length}/${checks} verificações`);
for (const x of problems) console.log(' -', x);
process.exitCode = problems.length ? 1 : 0;
