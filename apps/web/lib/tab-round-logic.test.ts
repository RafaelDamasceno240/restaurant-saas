import {
  addToDraft,
  cancelAsksStock,
  cancelNeedsManager,
  canServe,
  draftTotalCents,
  draftUnits,
  itemsNotDelivered,
  parseDraft,
  replaceDraftLine,
  setDraftNotes,
  setDraftQuantity,
  TAB_ITEM_STATUS_LABEL,
  tabUnitsOfProduct,
  toRoundItems,
  unsentLabel,
} from './tab-round-logic';

const burger = { id: 'p1', name: 'X-Burger', priceCents: 2500 };
const fries = { id: 'p2', name: 'Batata', priceCents: 1200 };

describe('tab-round-logic (B9)', () => {
  describe('the draft', () => {
    it('adds a unit to the line without notes, or starts a line', () => {
      let draft = addToDraft([], burger);
      draft = addToDraft(draft, burger);
      draft = addToDraft(draft, fries);
      expect(draft.map((l) => [l.name, l.quantity])).toEqual([
        ['X-Burger', 2],
        ['Batata', 1],
      ]);
      expect(draftUnits(draft)).toBe(3);
      expect(draftTotalCents(draft)).toBe(6200);
    });

    it('keeps a line with a note apart: the next tap starts a plain line', () => {
      let draft = addToDraft([], burger);
      draft = setDraftNotes(draft, draft[0].key, 'sem cebola');
      draft = addToDraft(draft, burger);
      expect(draft.map((l) => [l.quantity, l.notes])).toEqual([
        [1, 'sem cebola'],
        [1, ''],
      ]);
    });

    it('changes quantities freely and removes a line at zero', () => {
      let draft = addToDraft([], burger);
      draft = setDraftQuantity(draft, draft[0].key, 4);
      expect(draft[0].quantity).toBe(4);
      expect(setDraftQuantity(draft, draft[0].key, 0)).toEqual([]);
    });

    it('sends product, quantity and the trimmed note only - never a price', () => {
      let draft = addToDraft(addToDraft([], burger), fries);
      draft = setDraftNotes(draft, draft[0].key, '  bem passado ');
      expect(toRoundItems(draft)).toEqual([
        { productId: 'p1', quantity: 1, notes: 'bem passado' },
        { productId: 'p2', quantity: 1 },
      ]);
    });

    it('says how many items are still not sent', () => {
      expect(unsentLabel(1)).toBe('1 item ainda não enviado');
      expect(unsentLabel(3)).toBe('3 itens ainda não enviados');
    });
  });

  describe('the 50-units limit (B7) on a tab', () => {
    it('counts the active units on the tab plus the draft', () => {
      const items = [
        { productId: 'p1', activeQuantity: 30 },
        { productId: 'p1', activeQuantity: 15 },
        { productId: 'p2', activeQuantity: 9 },
      ];
      const draft = setDraftQuantity(addToDraft([], burger), addToDraft([], burger)[0].key, 1);
      expect(tabUnitsOfProduct(items, addToDraft([], burger), 'p1')).toBe(46);
      expect(tabUnitsOfProduct(items, draft, 'p2')).toBe(9);
    });
  });

  describe('sent items', () => {
    it('labels every status in Portuguese', () => {
      expect(TAB_ITEM_STATUS_LABEL).toEqual({
        SENT: 'Enviado',
        PREPARING: 'Em preparo',
        READY: 'Pronto',
        SERVED: 'Entregue',
        CANCELLED: 'Cancelado',
      });
    });

    it('lets the waiter deliver what the kitchen still has', () => {
      expect(['SENT', 'PREPARING', 'READY'].every((s) => canServe(s as never))).toBe(true);
      expect(canServe('SERVED')).toBe(false);
      expect(canServe('CANCELLED')).toBe(false);
    });

    it('asks for a manager once the kitchen has started, and asks about the stock only in preparation or ready', () => {
      expect(cancelNeedsManager('SENT')).toBe(false);
      expect(cancelNeedsManager('PREPARING')).toBe(true);
      expect(cancelNeedsManager('SERVED')).toBe(true);
      expect(cancelAsksStock('PREPARING')).toBe(true);
      expect(cancelAsksStock('READY')).toBe(true);
      expect(cancelAsksStock('SENT')).toBe(false);
      expect(cancelAsksStock('SERVED')).toBe(false);
    });

    it('counts the active units not delivered yet', () => {
      expect(
        itemsNotDelivered([
          { status: 'SENT', activeQuantity: 2 },
          { status: 'READY', activeQuantity: 1 },
          { status: 'SERVED', activeQuantity: 3 },
          { status: 'CANCELLED', activeQuantity: 0 },
        ]),
      ).toBe(3);
    });
  });

  describe('a draft saved on the device', () => {
    it('reads back a saved draft and drops anything malformed', () => {
      const saved = JSON.stringify([
        { key: 'a', productId: 'p1', name: 'X-Burger', unitPriceCents: 2500, quantity: 2, notes: 'sem cebola' },
        { productId: 'p2', name: 'Batata', unitPriceCents: 1200, quantity: 0, notes: '' },
        { productId: 3 },
        null,
      ]);
      // A draft saved before add-ons existed comes back with none.
      expect(parseDraft(saved)).toEqual([
        { key: 'a', productId: 'p1', name: 'X-Burger', unitPriceCents: 2500, quantity: 2, notes: 'sem cebola', options: [] },
      ]);
    });

    it('clamps a quantity over the limit and survives garbage', () => {
      const saved = JSON.stringify([{ key: 'a', productId: 'p1', name: 'X', unitPriceCents: 100, quantity: 80 }]);
      expect(parseDraft(saved)[0]).toMatchObject({ quantity: 50, notes: '' });
      expect(parseDraft('{not json')).toEqual([]);
      expect(parseDraft(null)).toEqual([]);
      expect(parseDraft('{"a":1}')).toEqual([]);
    });
  });
});

describe('tab-round-logic: add-ons in the draft', () => {
  const ponto = { optionId: 'o-ponto', groupName: 'Ponto', name: 'Ao ponto', priceCents: 0, quantity: 1 };
  const bacon = { optionId: 'o-bacon', groupName: 'Adicionais', name: 'Bacon', priceCents: 500, quantity: 2 };
  const custom = { id: 'p1', name: 'X-Burger', priceCents: 3500 };

  it('a personalized product is its own line; the same personalization adds up', () => {
    let draft = addToDraft([], burger);
    draft = addToDraft(draft, custom, { options: [ponto, bacon], notes: 'sem cebola', quantity: 2 });
    draft = addToDraft(draft, custom, { options: [bacon, ponto], notes: ' sem cebola ' });
    draft = addToDraft(draft, burger);
    expect(draft.map((l) => [l.quantity, l.options.length, l.notes])).toEqual([
      [2, 0, ''],
      [3, 2, 'sem cebola'],
    ]);
    expect(draftTotalCents(draft)).toBe(2 * 2500 + 3 * 3500);
  });

  it('sends the add-ons as ids and quantities only, never a price or a name', () => {
    const draft = addToDraft([], custom, { options: [ponto, bacon], notes: 'bem passado' });
    expect(toRoundItems(draft)).toEqual([
      { productId: 'p1', quantity: 1, options: [{ optionId: 'o-ponto', quantity: 1 }, { optionId: 'o-bacon', quantity: 2 }], notes: 'bem passado' },
    ]);
  });

  it('editing a line keeps its place, or joins the line that now has the same choice', () => {
    let draft = addToDraft([], custom, { options: [ponto] });
    draft = addToDraft(draft, fries);
    draft = replaceDraftLine(draft, draft[0].key, { name: 'X-Burger', priceCents: 3500, options: [ponto, bacon], notes: null, quantity: 3 });
    expect(draft.map((l) => [l.name, l.quantity, l.options.length])).toEqual([
      ['X-Burger', 3, 2],
      ['Batata', 1, 0],
    ]);
    draft = addToDraft(draft, custom, { options: [ponto] });
    draft = replaceDraftLine(draft, draft[2].key, { name: 'X-Burger', priceCents: 3500, options: [bacon, ponto], notes: '', quantity: 1 });
    expect(draft.map((l) => [l.name, l.quantity])).toEqual([
      ['X-Burger', 4],
      ['Batata', 1],
    ]);
  });

  it('a saved draft keeps its add-ons and drops malformed ones', () => {
    const saved = JSON.stringify([
      { key: 'a', productId: 'p1', name: 'X', unitPriceCents: 3500, quantity: 1, notes: '', options: [bacon, { optionId: 1 }, null] },
    ]);
    expect(parseDraft(saved)[0].options).toEqual([bacon]);
  });

  it('the 50 units count every line of the product, personalized or not', () => {
    let draft = addToDraft([], custom, { options: [ponto], quantity: 30 });
    draft = addToDraft(draft, burger);
    expect(tabUnitsOfProduct([{ productId: 'p1', activeQuantity: 10 }], draft, 'p1')).toBe(41);
  });
});
