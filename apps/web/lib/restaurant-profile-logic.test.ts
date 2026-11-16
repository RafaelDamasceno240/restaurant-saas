import { demoRestaurantProfile } from './demo/restaurant-profile';
import type { RestaurantProfileData } from './restaurant-profile';
import {
  draftIntervals,
  formatDayHours,
  formatDocument,
  formatFullAddress,
  instagramUrl,
  isEmptyPatch,
  mapsUrl,
  profileDraftToPatch,
  toProfileDraft,
  toProfileView,
  validateProfileDraft,
  weekHours,
  whatsappUrl,
} from './restaurant-profile-logic';

const EMPTY: RestaurantProfileData = {
  name: 'Casa do Burger',
  legalName: 'Casa do Burger LTDA',
  document: '12345678000199',
  slug: 'casa-do-burger',
  timezone: 'America/Sao_Paulo',
  description: null,
  instagram: null,
  branch: {
    id: 'b1',
    name: 'Matriz',
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    number: null,
    complement: null,
    neighborhood: null,
    city: null,
    state: null,
    zipCode: null,
    openingHours: null,
  },
  openNow: null,
};

const FILLED: RestaurantProfileData = {
  ...EMPTY,
  description: 'Hambúrgueres artesanais.',
  instagram: 'casa.do_burger',
  branch: {
    ...EMPTY.branch,
    phone: '3134567890',
    whatsapp: '31987654321',
    email: 'contato@casa.com.br',
    address: 'Rua das Flores',
    number: '120',
    complement: 'Loja 2',
    neighborhood: 'Centro',
    city: 'Belo Horizonte',
    state: 'MG',
    zipCode: '30110012',
    openingHours: [
      { weekday: 1, opens: '11:00', closes: '15:00' },
      { weekday: 1, opens: '18:00', closes: '23:00' },
      { weekday: 5, opens: '18:00', closes: '02:00' },
    ],
  },
  openNow: true,
};

describe('showing the profile', () => {
  it('formats hours per day, and the week Monday first', () => {
    const hours = FILLED.branch.openingHours!;
    expect(formatDayHours(hours, 1)).toBe('11:00 — 15:00 · 18:00 — 23:00');
    expect(formatDayHours(hours, 5)).toBe('18:00 — 02:00');
    expect(formatDayHours(hours, 2)).toBe('Fechado');
    expect(weekHours(hours).map((h) => h.day)).toEqual([
      'Segunda',
      'Terça',
      'Quarta',
      'Quinta',
      'Sexta',
      'Sábado',
      'Domingo',
    ]);
    expect(weekHours(null).every((h) => h.label === 'Não informado')).toBe(true);
  });

  it('builds the address line and the links', () => {
    const address = { ...FILLED.branch, street: FILLED.branch.address };
    expect(formatFullAddress(address)).toBe(
      'Rua das Flores, 120 - Loja 2 · Centro · Belo Horizonte/MG',
    );
    expect(
      formatFullAddress({
        ...address,
        street: null,
        number: null,
        complement: null,
        neighborhood: null,
      }),
    ).toBe('Belo Horizonte/MG');
    expect(mapsUrl(address)).toContain(encodeURIComponent('Rua das Flores, 120 - Loja 2'));
    expect(mapsUrl({ ...address, street: null })).toBeNull();
    expect(whatsappUrl('31987654321')).toBe('https://wa.me/5531987654321');
    expect(whatsappUrl('351912345678')).toBe('https://wa.me/351912345678');
    expect(instagramUrl('casa.do_burger')).toBe('https://www.instagram.com/casa.do_burger/');
    expect(formatDocument('12345678000199')).toBe('12.345.678/0001-99');
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
  });

  it('real mode shows only server data: nothing demonstrative, "Não informado" where empty', () => {
    const view = toProfileView(EMPTY, demoRestaurantProfile);
    expect(view.name).toBe('Casa do Burger');
    expect(view.category).toBe('');
    expect(view.description).toBe('');
    expect(view.phone).toBe('Não informado');
    expect(view.address).toEqual({
      street: 'Não informado',
      district: 'Não informado',
      region: 'Não informado',
    });
    expect(view.location).toBe('Endereço não informado');
    expect(view.status).toBeNull();
    expect(Object.values(view.demo).every((flag) => flag === false)).toBe(true);
    expect(JSON.stringify(view)).not.toContain('Rua Principal');

    const filled = toProfileView(FILLED, demoRestaurantProfile);
    expect(filled.phone).toBe('(31) 3456-7890');
    expect(filled.address.region).toBe('Belo Horizonte/MG · CEP 30110-012');
    expect(filled.status).toBe('open');
    expect(filled.channels.find((c) => c.key === 'instagram')?.value).toBe('@casa.do_burger');
    expect(filled.channels.find((c) => c.key === 'whatsapp')?.value).toBe('(31) 98765-4321');
    expect(toProfileView({ ...FILLED, openNow: false }, demoRestaurantProfile).status).toBe(
      'closed',
    );
  });
});

describe('editing the profile', () => {
  it('an untouched form sends nothing, empty or filled', () => {
    expect(isEmptyPatch(profileDraftToPatch(toProfileDraft(EMPTY), EMPTY))).toBe(true);
    expect(isEmptyPatch(profileDraftToPatch(toProfileDraft(FILLED), FILLED))).toBe(true);
  });

  it('the draft shows formatted values and the week with one ready shift per closed day', () => {
    const draft = toProfileDraft(FILLED);
    expect(draft).toMatchObject({
      phone: '(31) 3456-7890',
      instagram: '@casa.do_burger',
      zipCode: '30110-012',
      hoursEnabled: true,
    });
    expect(draft.days[0]).toMatchObject({
      weekday: 1,
      open: true,
      shifts: [{ opens: '11:00' }, { opens: '18:00' }],
    });
    expect(draft.days[1]).toMatchObject({
      weekday: 2,
      open: false,
      shifts: [{ opens: '18:00', closes: '23:00' }],
    });
    expect(toProfileDraft(EMPTY).hoursEnabled).toBe(false);
    expect(draftIntervals(draft.days)).toEqual(FILLED.branch.openingHours);
  });

  it('sends only what changed, blank as null, and the whole week when the hours change', () => {
    const draft = { ...toProfileDraft(FILLED), city: 'Contagem', complement: '  ', phone: '' };
    expect(profileDraftToPatch(draft, FILLED)).toEqual({
      city: 'Contagem',
      complement: null,
      phone: null,
    });

    const reformatted = {
      ...toProfileDraft(FILLED),
      phone: '31 3456 7890',
      instagram: 'casa.do_burger',
      zipCode: '30110012',
      state: 'mg',
    };
    expect(isEmptyPatch(profileDraftToPatch(reformatted, FILLED))).toBe(true);

    const hours = toProfileDraft(FILLED);
    hours.days[1] = { ...hours.days[1], open: true };
    expect(profileDraftToPatch(hours, FILLED)).toEqual({
      openingHours: [
        { weekday: 1, opens: '11:00', closes: '15:00' },
        { weekday: 1, opens: '18:00', closes: '23:00' },
        { weekday: 2, opens: '18:00', closes: '23:00' },
        { weekday: 5, opens: '18:00', closes: '02:00' },
      ],
    });

    expect(profileDraftToPatch({ ...toProfileDraft(FILLED), hoursEnabled: false }, FILLED)).toEqual(
      { openingHours: null },
    );
    // Turning the hours on with every day closed is "closed all week", not "not informed".
    expect(profileDraftToPatch({ ...toProfileDraft(EMPTY), hoursEnabled: true }, EMPTY)).toEqual({
      openingHours: [],
    });
  });

  it('validates in form order and leaves overlaps to the server', () => {
    const ok = toProfileDraft(FILLED);
    expect(validateProfileDraft(ok)).toBeNull();
    expect(validateProfileDraft({ ...ok, name: ' a ' })).toContain('nome');
    expect(validateProfileDraft({ ...ok, legalName: '' })).toContain('razão social');
    expect(validateProfileDraft({ ...ok, phone: '123' })).toContain('Telefone');
    expect(validateProfileDraft({ ...ok, whatsapp: '99' })).toContain('WhatsApp');
    expect(validateProfileDraft({ ...ok, instagram: 'instagram.com/x y' })).toContain('Instagram');
    expect(validateProfileDraft({ ...ok, email: 'x@' })).toContain('e-mail');
    expect(validateProfileDraft({ ...ok, state: 'XX' })).toBe('UF inválida.');
    expect(validateProfileDraft({ ...ok, zipCode: '123' })).toContain('CEP');
    const days = ok.days.map((d) =>
      d.weekday === 1 ? { ...d, shifts: [{ opens: '10:00', closes: '10:00' }] } : d,
    );
    expect(validateProfileDraft({ ...ok, days })).toContain('Segunda');
    const blank = ok.days.map((d) =>
      d.weekday === 5 ? { ...d, shifts: [{ opens: '', closes: '02:00' }] } : d,
    );
    expect(validateProfileDraft({ ...ok, days: blank })).toContain('Sexta');
    expect(validateProfileDraft({ ...ok, days: blank, hoursEnabled: false })).toBeNull();
    const overlapping = ok.days.map((d) =>
      d.weekday === 1
        ? {
            ...d,
            shifts: [
              { opens: '11:00', closes: '15:00' },
              { opens: '14:00', closes: '16:00' },
            ],
          }
        : d,
    );
    expect(validateProfileDraft({ ...ok, days: overlapping })).toBeNull();
  });
});
