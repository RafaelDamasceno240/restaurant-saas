// The neutral menu file produced by importacao-brendi/ferramentas/extrair-brendi.mjs (or by any
// other extractor that writes the same shape). Read and checked here before anything touches the
// database: a file with one error imports nothing.

export interface SourceImage {
  arquivo?: string | null;
  sha256?: string | null;
  urlOrigem?: string | null;
}

export interface SourceCategory {
  idOrigem: string;
  nome: string;
  ordem: number;
  produtos: string[];
}

export interface SourceProduct {
  idOrigem: string;
  nome: string;
  descricao: string | null;
  categoriaIdOrigem: string | null;
  ordemNaCategoria: number | null;
  precoCentavos: number;
  precoDeCentavos: number | null;
  esgotado: boolean;
  ativo: boolean;
  selos: string[];
  maisPedido: boolean;
  grupos: string[];
  imagem: SourceImage | null;
}

export interface SourceOption {
  idOrigem: string;
  nome: string;
  descricao: string | null;
  precoCentavos: number;
  maximoPorOpcao: number;
  ordem: number;
  esgotado: boolean;
  ativo: boolean;
  imagem: SourceImage | null;
}

export interface SourceGroup {
  idOrigem: string;
  nome: string;
  minimo: number;
  maximo: number;
  ativo: boolean;
  opcoes: SourceOption[];
}

export interface SourceStore {
  nome: string | null;
  telefoneWhatsapp: string | null;
  endereco: {
    rua: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
  } | null;
  horarios: { weekday: number; opens: string; closes: string }[];
  pedidoMinimoCentavos: number | null;
  entrega: {
    habilitada: boolean;
    faixas: { taxaCentavos: number }[];
    gratisAcimaDeCentavos?: number | null;
  } | null;
  logo: SourceImage | null;
  capa: SourceImage | null;
}

export interface SourceMenu {
  fonte: { plataforma: string; url: string; capturadoEm: string };
  loja: SourceStore;
  categorias: SourceCategory[];
  produtos: SourceProduct[];
  grupos: SourceGroup[];
}

// Same limits the API applies to what staff type (names, descriptions) and the database CHECKs.
export const LIMITS = {
  name: 120,
  description: 1000,
  maxSelect: 50,
  maxQuantity: 50,
  maxPriceCents: 10_000_000,
  lineNote: 140,
};

const BADGES: Record<string, 'NEW' | 'VEGETARIAN'> = { NOVIDADE: 'NEW', VEGETARIANO: 'VEGETARIAN' };

export function mapBadges(selos: string[]): ('NEW' | 'VEGETARIAN')[] {
  return [...new Set(selos.map((s) => BADGES[s]).filter((b): b is 'NEW' | 'VEGETARIAN' => !!b))];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function validateSource(raw: unknown): {
  menu: SourceMenu | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (
    !isObject(raw) ||
    !Array.isArray(raw.produtos) ||
    !Array.isArray(raw.categorias) ||
    !Array.isArray(raw.grupos)
  ) {
    return {
      menu: null,
      errors: ['O arquivo não tem "categorias", "produtos" e "grupos".'],
      warnings,
    };
  }
  const menu = raw as unknown as SourceMenu;
  if (!isObject(menu.fonte) || !text(menu.fonte.plataforma))
    errors.push('"fonte.plataforma" ausente.');
  if (!isObject(menu.loja)) errors.push('"loja" ausente.');

  const seen = new Set<string>();
  const unique = (kind: string, id: unknown) => {
    const key = `${kind}:${String(id)}`;
    if (!text(id)) errors.push(`${kind} sem idOrigem.`);
    else if (seen.has(key)) errors.push(`${kind} com idOrigem repetido: ${String(id)}.`);
    seen.add(key);
  };
  const name = (where: string, v: unknown) => {
    const t = text(v);
    if (!t) errors.push(`${where}: nome vazio.`);
    else if (t.length > LIMITS.name)
      errors.push(`${where}: nome com mais de ${LIMITS.name} caracteres.`);
  };
  const description = (where: string, v: unknown) => {
    if (v != null && typeof v !== 'string') errors.push(`${where}: descrição inválida.`);
    else if (typeof v === 'string' && v.length > LIMITS.description)
      errors.push(`${where}: descrição longa demais.`);
  };

  for (const c of menu.categorias) {
    unique('categoria', c.idOrigem);
    name(`Categoria "${c.nome}"`, c.nome);
    if (!Array.isArray(c.produtos))
      errors.push(`Categoria "${c.nome}": lista de produtos ausente.`);
  }
  const groupIds = new Set(menu.grupos.map((g) => g.idOrigem));
  for (const g of menu.grupos) {
    unique('grupo', g.idOrigem);
    const where = `Grupo "${g.nome}"`;
    name(where, g.nome);
    if (
      !isInt(g.minimo) ||
      !isInt(g.maximo) ||
      g.minimo < 0 ||
      g.maximo < 1 ||
      g.minimo > g.maximo ||
      g.maximo > LIMITS.maxSelect
    ) {
      errors.push(`${where}: mínimo/máximo inválidos (${g.minimo}/${g.maximo}).`);
    }
    if (!Array.isArray(g.opcoes) || g.opcoes.length === 0) errors.push(`${where}: sem opções.`);
    for (const o of g.opcoes ?? []) {
      unique('opção', o.idOrigem);
      const ow = `${where} / "${o.nome}"`;
      name(ow, o.nome);
      description(ow, o.descricao);
      if (!isInt(o.precoCentavos) || o.precoCentavos < 0 || o.precoCentavos > LIMITS.maxPriceCents)
        errors.push(`${ow}: preço inválido.`);
      if (
        !isInt(o.maximoPorOpcao) ||
        o.maximoPorOpcao < 1 ||
        o.maximoPorOpcao > LIMITS.maxQuantity
      ) {
        errors.push(`${ow}: quantidade máxima inválida (${o.maximoPorOpcao}).`);
      }
    }
  }
  const categoryIds = new Set(menu.categorias.map((c) => c.idOrigem));
  for (const p of menu.produtos) {
    unique('produto', p.idOrigem);
    const where = `Produto "${p.nome}"`;
    name(where, p.nome);
    description(where, p.descricao);
    // B6: no product is free on the menu.
    if (!isInt(p.precoCentavos) || p.precoCentavos < 1 || p.precoCentavos > LIMITS.maxPriceCents)
      errors.push(`${where}: preço inválido.`);
    if (
      p.precoDeCentavos != null &&
      (!isInt(p.precoDeCentavos) || p.precoDeCentavos <= p.precoCentavos)
    ) {
      errors.push(`${where}: preço "de" deve ser maior que o preço cobrado.`);
    }
    if (!p.categoriaIdOrigem || !categoryIds.has(p.categoriaIdOrigem))
      errors.push(`${where}: categoria desconhecida.`);
    for (const g of p.grupos ?? [])
      if (!groupIds.has(g)) errors.push(`${where}: grupo de adicionais desconhecido (${g}).`);
    for (const s of p.selos ?? [])
      if (!BADGES[s]) warnings.push(`${where}: selo "${s}" não existe no sistema e foi ignorado.`);
    if (!p.imagem?.arquivo) warnings.push(`${where}: sem foto.`);
  }
  return { menu: errors.length ? null : menu, errors, warnings };
}
