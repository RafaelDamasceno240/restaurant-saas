import {
  CurrentCatalog,
  buildPlan,
  countActions,
  hasConflicts,
  normalizeName,
} from './menu-import-plan';
import { SourceMenu, mapBadges, validateSource } from './menu-import-source';
import {
  changedStoreFields,
  parseImportArgs,
  storeBranchValues,
  UsageError,
} from '../../cli/import-menu.cli';

const source = (): SourceMenu => ({
  fonte: {
    plataforma: 'Brendi',
    url: 'https://exemplo/loja',
    capturadoEm: '2026-11-10T20:47:35.814Z',
  },
  loja: {
    nome: 'Loja',
    telefoneWhatsapp: '5535984171394',
    endereco: {
      rua: 'Rua A',
      numero: '70',
      complemento: null,
      bairro: 'Centro',
      cidade: 'Ilicínea',
      uf: 'MG',
      cep: '37175-000',
    },
    horarios: [{ weekday: 4, opens: '19:00', closes: '22:30' }],
    pedidoMinimoCentavos: 2100,
    entrega: { habilitada: true, faixas: [{ taxaCentavos: 300 }, { taxaCentavos: 300 }] },
    logo: null,
    capa: null,
  },
  categorias: [
    { idOrigem: 'c1', nome: 'Burgers', ordem: 1, produtos: ['p1', 'p2'] },
    { idOrigem: 'c2', nome: 'Promoção', ordem: 2, produtos: [] },
  ],
  grupos: [
    {
      idOrigem: 'g1',
      nome: 'Turbine seu lanche!',
      minimo: 0,
      maximo: 10,
      ativo: true,
      opcoes: [
        {
          idOrigem: 'o1',
          nome: 'Bacon',
          descricao: null,
          precoCentavos: 400,
          maximoPorOpcao: 10,
          ordem: 1,
          esgotado: false,
          ativo: true,
          imagem: null,
        },
        {
          idOrigem: 'o2',
          nome: 'Troca de pão',
          descricao: null,
          precoCentavos: 200,
          maximoPorOpcao: 10,
          ordem: 2,
          esgotado: true,
          ativo: true,
          imagem: null,
        },
      ],
    },
  ],
  produtos: [
    {
      idOrigem: 'p1',
      nome: 'Burger Tudo ',
      descricao: 'Pão brioche,  hambúrguer',
      categoriaIdOrigem: 'c1',
      ordemNaCategoria: 1,
      precoCentavos: 3400,
      precoDeCentavos: null,
      esgotado: false,
      ativo: true,
      selos: [],
      maisPedido: true,
      grupos: ['g1'],
      imagem: { arquivo: 'p1.jpg', sha256: 'a'.repeat(64) },
    },
    {
      idOrigem: 'p2',
      nome: 'Bacon Melt',
      descricao: null,
      categoriaIdOrigem: 'c1',
      ordemNaCategoria: 2,
      precoCentavos: 3200,
      precoDeCentavos: 3500,
      esgotado: true,
      ativo: true,
      selos: ['NOVIDADE', 'VEGETARIANO', 'DESCONHECIDO'],
      maisPedido: false,
      grupos: [],
      imagem: null,
    },
  ],
});

const empty = (): CurrentCatalog => ({
  categories: [],
  groups: [],
  options: [],
  products: [],
  links: [],
});

describe('validateSource', () => {
  it('accepts the extracted shape, with warnings for what the system cannot hold', () => {
    const { menu, errors, warnings } = validateSource(source());
    expect(errors).toEqual([]);
    expect(menu).not.toBeNull();
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DESCONHECIDO'),
        expect.stringContaining('sem foto'),
      ]),
    );
  });

  it('refuses free products, a "de" price not above the price, bad ranges, unknown groups and repeated ids', () => {
    const bad = source();
    bad.produtos[0].precoCentavos = 0;
    bad.produtos[1].precoDeCentavos = 3200;
    bad.produtos[1].grupos = ['nao-existe'];
    bad.grupos[0].minimo = 11;
    bad.grupos[0].opcoes[1].idOrigem = 'o1';
    const { menu, errors } = validateSource(bad);
    expect(menu).toBeNull();
    expect(errors.join('\n')).toMatch(/preço inválido/);
    expect(errors.join('\n')).toMatch(/preço "de"/);
    expect(errors.join('\n')).toMatch(/grupo de adicionais desconhecido/);
    expect(errors.join('\n')).toMatch(/mínimo\/máximo/);
    expect(errors.join('\n')).toMatch(/repetido/);
  });

  it('refuses something that is not a menu file', () => {
    expect(validateSource({ foo: 1 }).menu).toBeNull();
    expect(validateSource(null).errors).toHaveLength(1);
  });

  it('maps the badges it knows', () => {
    expect(mapBadges(['NOVIDADE', 'VEGETARIANO', 'NOVIDADE', 'X'])).toEqual(['NEW', 'VEGETARIAN']);
  });
});

describe('buildPlan', () => {
  const opts = { prefix: 'brendi', adoptByName: false };

  it('first run creates everything that has products, with clean names and externalIds', () => {
    const plan = buildPlan(source(), empty(), opts);
    expect(countActions(plan)).toEqual({
      categorias: { create: 1, update: 0, unchanged: 0, conflict: 0, adopt: 0 },
      grupos: { create: 1, update: 0, unchanged: 0, conflict: 0, adopt: 0 },
      adicionais: { create: 2, update: 0, unchanged: 0, conflict: 0, adopt: 0 },
      produtos: { create: 2, update: 0, unchanged: 0, conflict: 0, adopt: 0 },
    });
    expect(plan.skipped).toEqual(['Categoria "Promoção" sem produtos publicados: não importada.']);
    const [burger, melt] = plan.products;
    expect(burger.externalId).toBe('brendi:p1');
    expect(burger.desired).toMatchObject({
      name: 'Burger Tudo',
      description: 'Pão brioche, hambúrguer',
      featured: true,
      groupExternalIds: ['brendi:g1'],
    });
    expect(melt.desired).toMatchObject({
      priceCents: 3200,
      compareAtPriceCents: 3500,
      soldOut: true,
      badges: ['NEW', 'VEGETARIAN'],
    });
    expect(plan.options[1].desired.soldOut).toBe(true);
  });

  const imported = (): CurrentCatalog => ({
    categories: [
      { id: 'C1', externalId: 'brendi:c1', name: 'Burgers', displayOrder: 1, active: true },
    ],
    groups: [
      {
        id: 'G1',
        externalId: 'brendi:g1',
        name: 'Turbine seu lanche!',
        minSelect: 0,
        maxSelect: 10,
        active: true,
      },
    ],
    options: [
      {
        id: 'O1',
        groupId: 'G1',
        externalId: 'brendi:o1',
        name: 'Bacon',
        description: null,
        priceCents: 400,
        maxQuantity: 10,
        soldOut: false,
        displayOrder: 1,
        active: true,
        imageSha: null,
      },
      {
        id: 'O2',
        groupId: 'G1',
        externalId: 'brendi:o2',
        name: 'Troca de pão',
        description: null,
        priceCents: 200,
        maxQuantity: 10,
        soldOut: true,
        displayOrder: 2,
        active: true,
        imageSha: null,
      },
    ],
    products: [
      {
        id: 'P1',
        externalId: 'brendi:p1',
        categoryId: 'C1',
        name: 'Burger Tudo',
        description: 'Pão brioche, hambúrguer',
        priceCents: 3400,
        compareAtPriceCents: null,
        displayOrder: 1,
        soldOut: false,
        featured: true,
        badges: [],
        active: true,
        imageSha: 'a'.repeat(64),
      },
      {
        id: 'P2',
        externalId: 'brendi:p2',
        categoryId: 'C1',
        name: 'Bacon Melt',
        description: null,
        priceCents: 3200,
        compareAtPriceCents: 3500,
        displayOrder: 2,
        soldOut: true,
        featured: false,
        badges: ['VEGETARIAN', 'NEW'],
        active: true,
        imageSha: null,
      },
    ],
    links: [{ productId: 'P1', groupId: 'G1', displayOrder: 0 }],
  });

  it('running it again changes nothing (idempotent)', () => {
    const plan = buildPlan(source(), imported(), opts);
    const counts = countActions(plan);
    expect(
      Object.values(counts).every((c) => c.create + c.update + c.conflict + c.adopt === 0),
    ).toBe(true);
  });

  it('a new price at the source is an update of the imported row, with the change listed', () => {
    const changed = source();
    changed.produtos[0].precoCentavos = 3600;
    const plan = buildPlan(changed, imported(), opts);
    expect(plan.products[0]).toMatchObject({
      action: 'update',
      existingId: 'P1',
      changes: [{ field: 'priceCents', from: 3400, to: 3600 }],
    });
  });

  it('a hand-made product with the same name is a conflict, unless adopted on purpose', () => {
    const catalog = empty();
    catalog.categories.push({
      id: 'C9',
      externalId: null,
      name: 'Bebidas',
      displayOrder: 1,
      active: true,
    });
    catalog.products.push({
      id: 'MANUAL',
      externalId: null,
      categoryId: 'C9',
      name: 'burger  tudo',
      description: null,
      priceCents: 1000,
      compareAtPriceCents: null,
      displayOrder: 0,
      soldOut: false,
      featured: false,
      badges: [],
      active: true,
      imageSha: null,
    });
    const plan = buildPlan(source(), catalog, opts);
    expect(plan.products[0]).toMatchObject({ action: 'conflict', existingId: 'MANUAL' });
    expect(hasConflicts(plan)).toBe(true);
    const adopted = buildPlan(source(), catalog, { prefix: 'brendi', adoptByName: true });
    expect(adopted.products[0]).toMatchObject({ action: 'adopt', existingId: 'MANUAL' });
    expect(hasConflicts(adopted)).toBe(false);
  });

  it('reports rows imported before and gone from the source, without touching them', () => {
    const catalog = imported();
    catalog.products.push({
      ...catalog.products[1],
      id: 'P3',
      externalId: 'brendi:p3',
      name: 'Saiu do cardápio',
    });
    expect(buildPlan(source(), catalog, opts).missingFromSource).toEqual([
      { kind: 'produto', name: 'Saiu do cardápio', id: 'P3' },
    ]);
  });

  it('names compare without case, accents or repeated spaces', () => {
    expect(normalizeName('  Água   com Gás ')).toBe(normalizeName('agua com gas'));
  });
});

describe('import CLI', () => {
  it('needs the restaurant and the file; refuses unknown options and bad colors', () => {
    expect(parseImportArgs(['--arquivo', 'a.json', '--restaurante', 'doce'])).toMatchObject({
      file: 'a.json',
      tenant: 'doce',
      apply: false,
    });
    expect(() => parseImportArgs(['--arquivo', 'a.json'])).toThrow(UsageError);
    expect(() => parseImportArgs(['--restaurante', 'doce'])).toThrow(UsageError);
    expect(() =>
      parseImportArgs(['--restaurante', 'doce', '--arquivo', 'a', '--senha', 'x']),
    ).toThrow(UsageError);
    expect(() =>
      parseImportArgs(['--restaurante', 'doce', '--arquivo', 'a', '--cor-marca', 'vermelho']),
    ).toThrow(UsageError);
    expect(
      parseImportArgs(['--restaurante', 'doce', '--desfazer', 'r.json', '--aplicar']),
    ).toMatchObject({ undo: 'r.json', apply: true });
  });

  it('turns the store data into branch fields with the profile rules', () => {
    const warnings: string[] = [];
    expect(storeBranchValues(source(), warnings)).toEqual({
      openingHours: [{ weekday: 4, opens: '19:00', closes: '22:30' }],
      whatsapp: '35984171394',
      address: 'Rua A',
      number: '70',
      neighborhood: 'Centro',
      city: 'Ilicínea',
      state: 'MG',
      zipCode: '37175000',
      deliveryEnabled: true,
      deliveryFeeCents: 300,
      deliveryMinOrderCents: 2100,
    });
    expect(warnings).toEqual([]);
    const ranges = source();
    ranges.loja.entrega!.faixas = [{ taxaCentavos: 300 }, { taxaCentavos: 500 }];
    expect(storeBranchValues(ranges, warnings).deliveryFeeCents).toBe(500);
    expect(warnings[0]).toMatch(/por distância/);
  });
});

describe('changedStoreFields', () => {
  it('reports only what differs, comparing JSON whatever the key order', () => {
    const values = {
      openingHours: [{ weekday: 4, opens: '19:00', closes: '22:30' }],
      whatsapp: '35984171394',
      deliveryFreeAboveCents: 2300,
      complement: 'Loja 2',
    };
    const same = {
      openingHours: [{ closes: '22:30', opens: '19:00', weekday: 4 }],
      whatsapp: '35984171394',
      deliveryFreeAboveCents: 2300,
      complement: 'Loja 2',
    };
    expect(changedStoreFields(values, same)).toEqual([]);
    expect(
      changedStoreFields(values, { ...same, deliveryFreeAboveCents: null, complement: undefined }),
    ).toEqual(['deliveryFreeAboveCents', 'complement']);
    expect(
      changedStoreFields(values, {
        ...same,
        openingHours: [{ weekday: 4, opens: '18:00', closes: '22:30' }],
      }),
    ).toEqual(['openingHours']);
  });
});
