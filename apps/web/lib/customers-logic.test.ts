import type { CustomerRecord } from './customers-api';
import {
  CUSTOMER_TABS,
  customerErrorMessage,
  draftToInput,
  draftToPatch,
  EMPTY_DRAFT,
  formatCpf,
  formatPhone,
  isEmptyPatch,
  isFiltering,
  isValidCpf,
  lastOrderLabel,
  normalizePhone,
  toDraft,
  validateDraft,
} from './customers-logic';

const record: CustomerRecord = {
  id: 'c1',
  name: 'Maria Souza',
  phone: '11987654321',
  email: 'maria@example.com',
  cpf: '52998224725',
  notes: 'sem cebola',
  active: true,
  createdAt: '2026-09-30T12:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
};

describe('normalizePhone / formatPhone', () => {
  it('matches the API normalization', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('11987654321');
    expect(normalizePhone('+55 11 98765-4321')).toBe('11987654321');
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone('1234567890123456')).toBeNull();
  });

  it('formats national numbers and leaves others as stored', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('1134567890')).toBe('(11) 3456-7890');
    expect(formatPhone('14155552671')).toBe('(14) 15555-2671'); // 11 digits: indistinguishable from national
    expect(formatPhone('123456789')).toBe('123456789');
  });
});

describe('CPF', () => {
  it('validates check digits and rejects repeated sequences', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });

  it('formats with punctuation', () => {
    expect(formatCpf('52998224725')).toBe('529.982.247-25');
    expect(formatCpf('abc')).toBe('abc');
  });
});

describe('validateDraft', () => {
  const ok = { ...EMPTY_DRAFT, name: 'Maria', phone: '11987654321' };

  it('accepts name + phone only', () => {
    expect(validateDraft(ok)).toBeNull();
  });

  it('reports the first problem in form order', () => {
    expect(validateDraft({ ...ok, name: ' M ' })).toMatch(/nome/i);
    expect(validateDraft({ ...ok, phone: '12' })).toMatch(/telefone/i);
    expect(validateDraft({ ...ok, email: 'nope' })).toMatch(/e-mail/i);
    expect(validateDraft({ ...ok, cpf: '123.456.789-00' })).toMatch(/CPF/);
    expect(validateDraft({ ...ok, notes: 'x'.repeat(501) })).toMatch(/500/);
    expect(validateDraft({ ...ok, name: '', phone: '1', email: 'x' })).toMatch(/nome/i);
  });

  it('accepts optional fields when they are valid', () => {
    expect(validateDraft({ ...ok, email: 'a@b.co', cpf: '529.982.247-25', notes: 'ok' })).toBeNull();
  });
});

describe('draftToInput', () => {
  it('sends only what was filled in, trimmed', () => {
    expect(draftToInput({ ...EMPTY_DRAFT, name: '  Maria ', phone: ' 11987654321 ' })).toEqual({ name: 'Maria', phone: '11987654321' });
    expect(draftToInput({ name: 'Maria', phone: '11987654321', email: ' a@b.co ', cpf: '529.982.247-25', notes: ' n ' })).toEqual({
      name: 'Maria',
      phone: '11987654321',
      email: 'a@b.co',
      cpf: '529.982.247-25',
      notes: 'n',
    });
  });
});

describe('editing', () => {
  it('toDraft shows the stored values formatted for humans', () => {
    expect(toDraft(record)).toEqual({
      name: 'Maria Souza',
      phone: '(11) 98765-4321',
      email: 'maria@example.com',
      cpf: '529.982.247-25',
      notes: 'sem cebola',
    });
  });

  it('an untouched draft produces an empty patch (nothing to save)', () => {
    expect(isEmptyPatch(draftToPatch(toDraft(record), record))).toBe(true);
  });

  it('patches only the fields that changed and clears emptied optional ones with null', () => {
    const draft = { ...toDraft(record), name: 'Maria Silva', email: '', cpf: '', notes: '' };
    expect(draftToPatch(draft, record)).toEqual({ name: 'Maria Silva', email: null, cpf: null, notes: null });
  });

  it('a phone that only changed its punctuation is not a change', () => {
    expect(draftToPatch({ ...toDraft(record), phone: '+55 11 98765 4321' }, record)).toEqual({});
    expect(draftToPatch({ ...toDraft(record), phone: '11 91234-5678' }, record)).toEqual({ phone: '11 91234-5678' });
  });

  it('an e-mail that only changed case is not a change', () => {
    expect(draftToPatch({ ...toDraft(record), email: 'MARIA@example.com' }, record)).toEqual({});
  });
});

describe('labels', () => {
  it('maps API error codes to readable text and keeps unknown messages', () => {
    expect(customerErrorMessage('CUSTOMER_PHONE_TAKEN', 'x')).toMatch(/telefone/i);
    expect(customerErrorMessage('CUSTOMER_CPF_TAKEN', 'x')).toMatch(/CPF/);
    expect(customerErrorMessage('SOMETHING_ELSE', 'mensagem da API')).toBe('mensagem da API');
  });

  it('shows "Sem pedidos" instead of an invented date', () => {
    expect(lastOrderLabel(null)).toBe('Sem pedidos');
    expect(lastOrderLabel('2026-09-30T15:00:00.000Z')).toMatch(/\d{2}\/\d{2}\/2026/);
  });

  it('knows when the list is being filtered', () => {
    expect(isFiltering('', 'active')).toBe(false);
    expect(isFiltering('  ', 'active')).toBe(false);
    expect(isFiltering('ana', 'active')).toBe(true);
    expect(isFiltering('', 'inactive')).toBe(true);
    expect(isFiltering('', 'all')).toBe(true);
    expect(CUSTOMER_TABS).toEqual(['active', 'inactive', 'all']);
  });
});
