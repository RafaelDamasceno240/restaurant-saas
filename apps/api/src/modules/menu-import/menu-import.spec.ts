import {
  CurrentCatalog,
  buildPlan,
  catalogFingerprints,
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
      categorias: { create: 1, update: 0, unchanged: 0, conflict: 0, adopt: 0, kept: 0 },
      grupos: { create: 1, update: 0, unchanged: 0, conflict: 0, adopt: 0, kept: 0 },
      adicionais: { create: 2, update: 0, unchanged: 0, conflict: 0, adopt: 0, kept: 0 },
      produtos: { create: 2, update: 0, unchanged: 0, conflict: 0, adopt: 0, kept: 0 },
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

  describe('edits made in the panel after an import', () => {
    // The fingerprints an applied import leaves: exactly what is in the database right after it.
    const baseline = () => catalogFingerprints(imported(), 'brendi');
    const protectedOpts = (overwriteEdits = false) => ({
      ...opts,
      baseline: baseline(),
      overwriteEdits,
    });

    it('nothing edited: a rerun with the baseline changes nothing and keeps nothing', () => {
      const counts = countActions(buildPlan(source(), imported(), protectedOpts()));
      expect(
        Object.values(counts).every((c) => c.kept === 0 && c.update === 0 && c.create === 0),
      ).toBe(true);
    });

    it('a price changed in the panel is kept, even when the source changed it too', () => {
      const catalog = imported();
      catalog.products[0].priceCents = 3900; // the owner raised it in the panel
      const changed = source();
      changed.produtos[0].precoCentavos = 3600; // and the source has a new price
      const plan = buildPlan(changed, catalog, protectedOpts());
      expect(plan.products[0]).toMatchObject({
        action: 'kept',
        keptReason: 'edited',
        existingId: 'P1',
        changes: [{ field: 'priceCents', from: 3900, to: 3600 }],
      });
      // The other product, untouched in the panel, still follows the source.
      expect(plan.products[1].action).toBe('unchanged');
      // On purpose, the source wins again.
      expect(buildPlan(changed, catalog, protectedOpts(true)).products[0].action).toBe('update');
    });

    it('sold out, a new photo or other add-on groups set in the panel count as edits', () => {
      for (const edit of [
        (c: CurrentCatalog) => (c.products[0].soldOut = true),
        (c: CurrentCatalog) => (c.products[0].imageSha = 'b'.repeat(64)),
        (c: CurrentCatalog) => (c.links = []),
        (c: CurrentCatalog) => (c.options[0].priceCents = 500),
        (c: CurrentCatalog) => (c.groups[0].minSelect = 1),
      ]) {
        const catalog = imported();
        edit(catalog);
        const plan = buildPlan(source(), catalog, protectedOpts());
        const kept = [...plan.products, ...plan.options, ...plan.groups].filter(
          (r) => r.action === 'kept',
        );
        expect(kept).toHaveLength(1);
        expect(kept[0].keptReason).toBe('edited');
      }
    });

    it('a group created in the panel and hung on an imported product is not an edit nor a change', () => {
      const catalog = imported();
      catalog.groups.push({
        id: 'GM',
        externalId: null,
        name: 'Molhos',
        minSelect: 0,
        maxSelect: 2,
        active: true,
      });
      catalog.links.push({ productId: 'P1', groupId: 'GM', displayOrder: 5 });
      expect(catalogFingerprints(catalog, 'brendi')['brendi:p1']).toBe(baseline()['brendi:p1']);
      expect(buildPlan(source(), catalog, protectedOpts()).products[0].action).toBe('unchanged');
    });

    it('a product deleted in the panel is not created again', () => {
      const catalog = imported();
      catalog.products = catalog.products.filter((p) => p.id !== 'P2');
      const plan = buildPlan(source(), catalog, protectedOpts());
      expect(plan.products[1]).toMatchObject({
        action: 'kept',
        keptReason: 'deleted',
        existingId: null,
      });
      expect(buildPlan(source(), catalog, protectedOpts(true)).products[1].action).toBe('create');
    });

    it('a new option of a group deleted in the panel has nowhere to go and is kept out', () => {
      const catalog = imported();
      catalog.groups = [];
      catalog.options = [];
      catalog.links = [];
      const plan = buildPlan(source(), catalog, protectedOpts());
      expect(plan.groups[0]).toMatchObject({ action: 'kept', keptReason: 'deleted' });
      expect(plan.options.map((o) => o.action)).toEqual(['kept', 'kept']);
    });

    it('without a baseline nothing is protected (the CLI refuses to write in that case)', () => {
      const catalog = imported();
      catalog.products[0].priceCents = 3900;
      expect(buildPlan(source(), catalog, opts).products[0].action).toBe('update');
    });

    it('fingerprints cover only the rows of the prefix, and follow every managed field', () => {
      const catalog = imported();
      catalog.products.push({
        ...catalog.products[1],
        id: 'MANUAL',
        externalId: null,
        name: 'Feito à mão',
      });
      const prints = catalogFingerprints(catalog, 'brendi');
      expect(Object.keys(prints).sort()).toEqual(
        ['brendi:c1', 'brendi:g1', 'brendi:o1', 'brendi:o2', 'brendi:p1', 'brendi:p2'].sort(),
      );
      catalog.products[1].badges = ['NEW', 'VEGETARIAN']; // same badges, other order
      expect(catalogFingerprints(catalog, 'brendi')['brendi:p2']).toBe(prints['brendi:p2']);
      catalog.products[1].description = 'nova';
      expect(catalogFingerprints(catalog, 'brendi')['brendi:p2']).not.toBe(prints['brendi:p2']);
    });
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
