import {
  EMPTY_NEW_TENANT,
  NEW_TENANT_FIELDS,
  newTenantError,
  pageRangeLabel,
  statusActions,
  suggestSlug,
  toNewTenantInput,
  validateNewTenant,
  validateSuspensionReason,
} from './platform-logic';
import { dashboardNav, SUPER_ADMIN_NAV } from '@/components/shell/nav';

const VALID = {
  ...EMPTY_NEW_TENANT,
  tenantName: 'Restaurante Central',
  legalName: 'Empresa Central LTDA',
  document: '12.345.678/0001-99',
  slug: 'restaurante-central',
  branchName: 'Matriz Centro',
  userName: 'João da Silva',
  email: 'contato@empresa.com.br',
  password: 'Senha#Forte-2026',
  passwordConfirmation: 'Senha#Forte-2026',
};

describe('suggestSlug', () => {
  it.each([
    ['Restaurante Central', 'restaurante-central'],
    ['  Do’cê Hamburgueria & Cia  ', 'doce-hamburgueria-cia'],
    ['Pão de Açúcar -- Matriz', 'pao-de-acucar-matriz'],
    ['ÁÉÍÓÚ çãõ', 'aeiou-cao'],
    ['---', ''],
  ])('%p -> %p', (name, slug) => {
    expect(suggestSlug(name)).toBe(slug);
  });
});

describe('the new restaurant form', () => {
  it('shows the agreed examples, never a password as one', () => {
    expect(Object.fromEntries(NEW_TENANT_FIELDS.map((f) => [f.label, f.example]))).toEqual({
      'Nome do restaurante': 'Restaurante Central',
      'Razão social': 'Empresa Central LTDA',
      'CNPJ/CPF': '12345678000199',
      Slug: 'restaurante-central',
      'Unidade principal': 'Matriz Centro',
      'Nome do proprietário': 'João da Silva',
      'E-mail do proprietário': 'contato@empresa.com.br',
    });
  });

  it('accepts a complete form and sends the document in digits, without the confirmation', () => {
    expect(validateNewTenant(VALID)).toEqual({});
    const input = toNewTenantInput({ ...VALID, tenantName: '  Restaurante Central ' });
    expect(input).toEqual({
      tenantName: 'Restaurante Central',
      legalName: 'Empresa Central LTDA',
      document: '12345678000199',
      slug: 'restaurante-central',
      branchName: 'Matriz Centro',
      userName: 'João da Silva',
      email: 'contato@empresa.com.br',
      password: 'Senha#Forte-2026',
    });
    expect(Object.keys(input)).not.toContain('passwordConfirmation');
  });

  it('says what is wrong, field by field', () => {
    expect(validateNewTenant(EMPTY_NEW_TENANT)).toMatchObject({
      tenantName: 'Informe o nome do restaurante.',
      password: 'Informe a senha inicial.',
    });
    expect(validateNewTenant({ ...VALID, document: '123' }).document).toBe('CNPJ com 14 dígitos ou CPF com 11.');
    expect(validateNewTenant({ ...VALID, slug: 'Restaurante Central' }).slug).toMatch(/minúsculas/);
    expect(validateNewTenant({ ...VALID, email: 'contato' }).email).toBe('E-mail inválido.');
    expect(validateNewTenant({ ...VALID, password: 'curta', passwordConfirmation: 'curta' }).password).toMatch(/8/);
    expect(validateNewTenant({ ...VALID, passwordConfirmation: 'outra' }).passwordConfirmation).toBe(
      'As senhas não conferem.',
    );
  });

  it('puts a duplicate on the field it is about', () => {
    expect(newTenantError('SLUG_ALREADY_EXISTS', 'x')).toEqual({
      field: 'slug',
      message: 'Já existe um restaurante com este slug. Escolha outro.',
    });
    expect(newTenantError('DOCUMENT_ALREADY_EXISTS', 'x').field).toBe('document');
    expect(newTenantError('EMAIL_ALREADY_EXISTS', 'x').field).toBe('email');
    expect(newTenantError(undefined, 'Falhou.')).toEqual({ message: 'Falhou.' });
  });
});

describe('status actions', () => {
  it('suspends ACTIVE and TRIAL, reactivates only SUSPENDED, nothing for CANCELLED', () => {
    expect(statusActions('ACTIVE')).toEqual({ canSuspend: true, canReactivate: false });
    expect(statusActions('TRIAL')).toEqual({ canSuspend: true, canReactivate: false });
    expect(statusActions('SUSPENDED')).toEqual({ canSuspend: false, canReactivate: true });
    expect(statusActions('CANCELLED')).toEqual({ canSuspend: false, canReactivate: false });
  });

  it('requires a reason to suspend', () => {
    expect(validateSuspensionReason('   ')).toMatch(/motivo/);
    expect(validateSuspensionReason('Pagamento em atraso')).toBeNull();
    expect(validateSuspensionReason('x'.repeat(501))).toMatch(/500/);
  });
});

describe('pagination label', () => {
  it('counts the rows of the page', () => {
    expect(pageRangeLabel({ page: 2, pageSize: 20, total: 2063 })).toBe('21–40 de 2.063');
    expect(pageRangeLabel({ page: 104, pageSize: 20, total: 2063 })).toBe('2.061–2.063 de 2.063');
    expect(pageRangeLabel({ page: 1, pageSize: 20, total: 0 })).toBe('Nenhum restaurante');
  });
});

describe('menus', () => {
  const hrefs = (groups: { items: { href?: string }[] }[]) => groups.flatMap((g) => g.items.map((i) => i.href));

  it('the restaurant panel shows the way to /super-admin only to a platform administrator', () => {
    expect(hrefs(dashboardNav(['OWNER'], false))).not.toContain('/super-admin');
    expect(hrefs(dashboardNav(['OWNER'], true))).toContain('/super-admin');
    expect(hrefs(dashboardNav(['CASHIER'], true))).toContain('/super-admin');
  });

  it('the platform has its own menu, with none of a restaurant’s screens', () => {
    expect(SUPER_ADMIN_NAV.map((g) => g.label)).toEqual(['Administração da Plataforma']);
    expect(SUPER_ADMIN_NAV.flatMap((g) => g.items.map((i) => [i.label, i.href]))).toEqual([
      ['Visão geral', '/super-admin'],
      ['Restaurantes', '/super-admin/restaurantes'],
    ]);
  });
});
