import {
  addressSummary,
  attemptLabel,
  centsToInput,
  defaultCourierFilter,
  DELIVERY_STATUS_LABEL,
  DELIVERY_TABS,
  historyAttempt,
  historyDetail,
  HISTORY_KIND_LABEL,
  isValidFailureReason,
  localDayRange,
} from './delivery-logic';
import { costToCents } from './purchases-logic';

const base = {
  street: 'Rua das Flores',
  number: '120',
  complement: null,
  neighborhood: 'Centro',
  city: 'São Paulo',
  state: 'SP',
  zipCode: '01310-100',
};

describe('addressSummary', () => {
  it('joins street, number, neighborhood and city/state', () => {
    expect(addressSummary(base)).toBe('Rua das Flores, 120 — Centro, São Paulo/SP');
  });

  it('includes the complement when present', () => {
    expect(addressSummary({ ...base, complement: 'Ap 4' })).toBe('Rua das Flores, 120 · Ap 4 — Centro, São Paulo/SP');
  });

  it('does not leave dangling separators when parts are missing', () => {
    expect(addressSummary({ ...base, number: '', neighborhood: '', city: 'Campinas', state: '' })).toBe(
      'Rua das Flores — Campinas',
    );
  });
});

describe('centsToInput', () => {
  it('formats integer cents as a decimal-comma string', () => {
    expect(centsToInput(0)).toBe('0,00');
    expect(centsToInput(5)).toBe('0,05');
    expect(centsToInput(500)).toBe('5,00');
    expect(centsToInput(123456)).toBe('1234,56');
  });

  it('round-trips through the money parser used by the inputs', () => {
    for (const cents of [0, 1, 99, 100, 550, 100000]) {
      expect(costToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

describe('DELIVERY_STATUS_LABEL / DELIVERY_TABS', () => {
  it('has a label for every status, including FAILED', () => {
    expect(Object.keys(DELIVERY_STATUS_LABEL).sort()).toEqual([
      'CANCELLED',
      'DELIVERED',
      'FAILED',
      'OUT_FOR_DELIVERY',
      'PENDING',
    ]);
  });

  it('shows a tab for every status, with the ones that need action first', () => {
    expect([...DELIVERY_TABS].sort()).toEqual(Object.keys(DELIVERY_STATUS_LABEL).sort());
    expect(DELIVERY_TABS.slice(0, 3)).toEqual(['PENDING', 'OUT_FOR_DELIVERY', 'FAILED']);
  });
});

describe('localDayRange', () => {
  it('covers exactly one local day, from 00:00:00.000 to 23:59:59.999', () => {
    const { from, to } = localDayRange('2026-10-01');
    const start = new Date(from);
    const end = new Date(to);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2026, 9, 1, 0, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getMilliseconds()]).toEqual([
      2026, 9, 1, 23, 59, 999,
    ]);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });

  it('returns ISO instants the API accepts', () => {
    const { from, to } = localDayRange('2026-12-31');
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('attemptLabel', () => {
  it('shows nothing for a first attempt', () => {
    expect(attemptLabel({ status: 'PENDING', attemptCount: 0 })).toBeNull();
    expect(attemptLabel({ status: 'OUT_FOR_DELIVERY', attemptCount: 1 })).toBeNull();
    expect(attemptLabel({ status: 'FAILED', attemptCount: 1 })).toBeNull();
  });

  it('flags a delivery waiting for another attempt', () => {
    expect(attemptLabel({ status: 'PENDING', attemptCount: 1 })).toBe('Reentrega · 2ª tentativa');
    expect(attemptLabel({ status: 'PENDING', attemptCount: 2 })).toBe('Reentrega · 3ª tentativa');
  });

  it('shows the attempt number once there was more than one dispatch', () => {
    expect(attemptLabel({ status: 'OUT_FOR_DELIVERY', attemptCount: 2 })).toBe('2ª tentativa');
    expect(attemptLabel({ status: 'DELIVERED', attemptCount: 3 })).toBe('3ª tentativa');
  });
});

describe('isValidFailureReason', () => {
  it('requires 3 to 300 characters after trimming', () => {
    expect(isValidFailureReason('ab')).toBe(false);
    expect(isValidFailureReason('   ab   ')).toBe(false);
    expect(isValidFailureReason('abc')).toBe(true);
    expect(isValidFailureReason(`  ${'x'.repeat(300)}  `)).toBe(true);
    expect(isValidFailureReason('x'.repeat(301))).toBe(false);
  });
});

describe('defaultCourierFilter', () => {
  it('starts a courier on their own deliveries and management on everything', () => {
    expect(defaultCourierFilter(['DELIVERY'])).toBe('me');
    expect(defaultCourierFilter(['MANAGER'])).toBe('');
    expect(defaultCourierFilter(['ADMIN', 'DELIVERY'])).toBe('');
    expect(defaultCourierFilter(['OWNER'])).toBe('');
    expect(defaultCourierFilter([])).toBe('');
  });
});

describe('history presentation', () => {
  const ana = { id: '1', name: 'Ana' };
  const bia = { id: '2', name: 'Bia' };

  it('labels every kind', () => {
    expect(HISTORY_KIND_LABEL.CREATED).toBe('Pedido de entrega criado');
    expect(Object.keys(HISTORY_KIND_LABEL)).toHaveLength(10);
  });

  it('describes assignments and failures', () => {
    expect(historyDetail({ kind: 'ASSIGNED', reason: null, courier: ana, previousCourier: null })).toBe('Ana');
    expect(historyDetail({ kind: 'REASSIGNED', reason: null, courier: bia, previousCourier: ana })).toBe('Ana → Bia');
    expect(historyDetail({ kind: 'UNASSIGNED', reason: null, courier: null, previousCourier: ana })).toBe('Ana');
    expect(historyDetail({ kind: 'FAILED', reason: 'Cliente ausente', courier: null, previousCourier: null })).toBe('Cliente ausente');
    expect(historyDetail({ kind: 'COMPLETED', reason: null, courier: null, previousCourier: null })).toBeNull();
  });

  it('survives a user that no longer resolves', () => {
    expect(historyDetail({ kind: 'ASSIGNED', reason: null, courier: { id: '9', name: null }, previousCourier: null })).toBe('usuário removido');
  });

  it('numbers attempts only when there is one', () => {
    expect(historyAttempt({ attempt: 2 })).toBe('2ª tentativa');
    expect(historyAttempt({ attempt: null })).toBeNull();
  });
});
