import { act, createElement as h, ReactNode } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/lib/api-client';
import SuperAdminLayout from './layout';
import OverviewPage from './page';
import TenantsPage from './restaurantes/page';
import TenantDetailPage from './restaurantes/[id]/page';

// /super-admin rendered for real (plain react-dom, no JSX: Jest here only picks up *.test.ts),
// with the session and the /platform API replaced. The API is the real gate; these check that
// the screens never ask it for anything on behalf of someone who is not a platform administrator,
// and that the panel does what it says.

const session: { user: Record<string, unknown> | null } = { user: null };
jest.mock('../../lib/auth-context', () => ({
  useAuth: () => ({
    user: session.user,
    accessToken: session.user ? 'token' : null,
    isLoading: false,
    sessionUnavailable: false,
    retrySession: jest.fn(),
    logout: jest.fn(),
  }),
}));

const push = jest.fn();
const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/super-admin',
  useParams: () => ({ id: 'tenant-1' }),
}));

jest.mock('../../lib/platform-api', () => ({
  platformApi: {
    overview: jest.fn(),
    list: jest.fn(),
    detail: jest.fn(),
    create: jest.fn(),
    suspend: jest.fn(),
    reactivate: jest.fn(),
  },
}));
const { platformApi } = jest.requireMock('../../lib/platform-api') as { platformApi: Record<string, jest.Mock> };

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ADMIN = { id: 'u1', tenantId: 't0', name: 'Ana', email: 'ana@plataforma.com', roles: ['OWNER'], isPlatformAdmin: true };
const OWNER = { ...ADMIN, isPlatformAdmin: false };

const row = (i: number, status = 'TRIAL') => ({
  id: `tenant-${i}`,
  name: `Restaurante ${i}`,
  slug: `restaurante-${i}`,
  status,
  createdAt: '2026-10-20T12:00:00.000Z',
  branchCount: 1,
  ownerEmail: `dono${i}@example.com`,
});

const detail = (status = 'TRIAL') => ({
  id: 'tenant-1',
  name: 'Restaurante Central',
  legalName: 'Empresa Central LTDA',
  document: '12.***.***/****-99',
  slug: 'restaurante-central',
  status,
  timezone: 'America/Sao_Paulo',
  createdAt: '2026-10-20T12:00:00.000Z',
  updatedAt: '2026-10-20T12:00:00.000Z',
  branches: [{ id: 'b1', name: 'Matriz Centro', code: 'MATRIZ', status: 'ACTIVE', deliveryEnabled: false }],
  mainBranchDeliveryEnabled: false,
  owners: [{ id: 'o1', name: 'João da Silva', email: 'contato@empresa.com.br', status: 'ACTIVE' }],
  userCount: 1,
  suspension:
    status === 'SUSPENDED'
      ? { action: 'PLATFORM_TENANT_SUSPENDED', at: '2026-10-21T12:00:00.000Z', by: { name: 'Ana', email: ADMIN.email }, reason: 'Pagamento em atraso' }
      : null,
  history: [],
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  platformApi.overview.mockResolvedValue({ total: 2063, byStatus: { ACTIVE: 10, TRIAL: 2050, SUSPENDED: 3, CANCELLED: 0 } });
  platformApi.list.mockImplementation(async (_t: string, q: { page?: number; search?: string }) => ({
    items: q.search ? [row(7)] : [row((q.page ?? 1) * 10 + 1), row((q.page ?? 1) * 10 + 2, 'SUSPENDED')],
    meta: { page: q.page ?? 1, pageSize: 20, total: q.search ? 1 : 45, totalPages: q.search ? 1 : 3 },
  }));
  platformApi.detail.mockResolvedValue(detail());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

async function render(page: () => ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(h(QueryClientProvider, { client }, h(SuperAdminLayout, null, h(page as never))));
  });
  await flush();
  await flush();
}

const text = () => container.textContent ?? '';
const byText = (selector: string, label: string | RegExp) =>
  [...container.querySelectorAll<HTMLElement>(selector)].find((el) =>
    typeof label === 'string' ? el.textContent?.trim() === label : label.test(el.textContent ?? ''),
  );
async function click(el: Element | undefined | null) {
  if (!el) throw new Error('element not found');
  await act(async () => (el as HTMLElement).click());
  await flush();
}
async function type(el: Element | null, value: string) {
  if (!el) throw new Error('field not found');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const field = (name: string) => container.querySelector<HTMLInputElement>(`#new-tenant-${name}`);

describe('who sees /super-admin', () => {
  it('an account that is not a platform administrator gets "Acesso negado" and no /platform request', async () => {
    session.user = OWNER;
    await render(OverviewPage);
    expect(text()).toContain('Acesso negado');
    expect(text()).not.toContain('Restaurantes totais');
    expect(Object.values(platformApi).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('a platform administrator gets the platform frame, with its own menu and none of a restaurant’s', async () => {
    session.user = ADMIN;
    await render(OverviewPage);
    expect(text()).toContain('Administração da Plataforma');
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(expect.arrayContaining(['/super-admin', '/super-admin/restaurantes']));
    expect(links).not.toContain('/dashboard/pdv');
  });
});

describe('dashboard', () => {
  it('shows totals by real status', async () => {
    session.user = ADMIN;
    await render(OverviewPage);
    for (const label of ['Restaurantes totais', 'Ativo', 'Em teste (trial)', 'Suspensos', 'Cancelados']) {
      expect(text()).toContain(label);
    }
    expect(text()).toContain('2063');
  });
});

describe('restaurants list', () => {
  beforeEach(() => {
    session.user = ADMIN;
  });

  it('lists a page, pages forward and searches', async () => {
    await render(TenantsPage);
    expect(platformApi.list).toHaveBeenLastCalledWith('token', { search: '', page: 1, pageSize: 20 });
    expect(text()).toContain('Restaurante 11');
    expect(text()).toContain('dono11@example.com');
    expect(text()).toContain('Suspenso');
    expect(text()).toContain('1–20 de 45');

    await click(byText('button', /Próxima/));
    expect(platformApi.list).toHaveBeenLastCalledWith('token', { search: '', page: 2, pageSize: 20 });
    expect(text()).toContain('Restaurante 21');

    await type(container.querySelector('input[type="search"]'), 'restaurante-7');
    await wait(350);
    await flush();
    expect(platformApi.list).toHaveBeenLastCalledWith('token', { search: 'restaurante-7', page: 1, pageSize: 20 });
    expect(text()).toContain('Restaurante 7');
  });

  it('a page chosen right after the list opens is not undone by the search delay', async () => {
    await render(TenantsPage);
    await click(byText('button', /Próxima/));
    await wait(350);
    await flush();
    expect(platformApi.list).toHaveBeenLastCalledWith('token', { search: '', page: 2, pageSize: 20 });
    expect(text()).toContain('página 2 de 3');
  });

  it('the form: examples, suggested slug, hidden password with confirmation, duplicate on its field', async () => {
    await render(TenantsPage);
    await click(byText('button', 'Novo restaurante'));

    for (const example of [
      'Restaurante Central',
      'Empresa Central LTDA',
      '12345678000199',
      'restaurante-central',
      'Matriz Centro',
      'João da Silva',
      'contato@empresa.com.br',
      'use uma senha forte com letras, números e símbolos',
    ]) {
      expect(text()).toContain(`Exemplo: ${example}`);
    }
    expect(field('password')?.type).toBe('password');
    expect(field('passwordConfirmation')?.type).toBe('password');

    await type(field('tenantName'), 'Pão & Cia Central');
    expect(field('slug')?.value).toBe('pao-cia-central');
    // Edited by hand, the slug stops following the name.
    await type(field('slug'), 'pao-central');
    await type(field('tenantName'), 'Pão & Cia Central Matriz');
    expect(field('slug')?.value).toBe('pao-central');

    await type(field('legalName'), 'Pão e Cia LTDA');
    await type(field('document'), '12.345.678/0001-99');
    await type(field('branchName'), 'Matriz Centro');
    await type(field('userName'), 'João da Silva');
    await type(field('email'), 'joao@example.com');
    await type(field('password'), 'Senha#Forte-2026');
    await type(field('passwordConfirmation'), 'Senha#Outra-2026');
    await click(byText('button', 'Criar restaurante'));
    expect(text()).toContain('As senhas não conferem.');
    expect(platformApi.create).not.toHaveBeenCalled();

    platformApi.create.mockRejectedValueOnce(new ApiError(409, 'SLUG_ALREADY_EXISTS', 'Já existe um restaurante com este slug.'));
    await type(field('passwordConfirmation'), 'Senha#Forte-2026');
    await click(byText('button', 'Criar restaurante'));
    expect(platformApi.create).toHaveBeenCalledWith('token', {
      tenantName: 'Pão & Cia Central Matriz',
      legalName: 'Pão e Cia LTDA',
      document: '12345678000199',
      slug: 'pao-central',
      branchName: 'Matriz Centro',
      userName: 'João da Silva',
      email: 'joao@example.com',
      password: 'Senha#Forte-2026',
    });
    expect(text()).toContain('Já existe um restaurante com este slug. Escolha outro.');
    // The password is never written on the page (only inside its own masked inputs).
    expect(text()).not.toContain('Senha#Forte-2026');
    const holders = [...container.querySelectorAll('input')].filter((i) => i.value === 'Senha#Forte-2026');
    expect(holders.map((i) => i.type)).toEqual(['password', 'password']);

    platformApi.create.mockResolvedValueOnce(detail());
    await type(field('slug'), 'pao-central-2');
    await click(byText('button', 'Criar restaurante'));
    expect(push).toHaveBeenCalledWith('/super-admin/restaurantes/tenant-1');
  });
});

describe('restaurant detail', () => {
  beforeEach(() => {
    session.user = ADMIN;
  });

  it('shows the restaurant without sensitive data', async () => {
    await render(TenantDetailPage);
    for (const shown of ['Restaurante Central', 'Empresa Central LTDA', '12.***.***/****-99', 'America/Sao_Paulo', 'Matriz Centro', 'contato@empresa.com.br', 'Desligado']) {
      expect(text()).toContain(shown);
    }
  });

  it('suspends only with a reason and an explicit confirmation', async () => {
    platformApi.suspend.mockResolvedValue(detail('SUSPENDED'));
    await render(TenantDetailPage);
    await click(byText('button', 'Suspender'));

    expect(text()).toContain(
      'Suspender este restaurante impedirá o uso do sistema pelos usuários deste estabelecimento.',
    );
    const confirm = byText('button', 'Suspender restaurante') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await click(container.querySelector('input[type="checkbox"]'));
    await type(container.querySelector('#suspend-reason'), 'x');
    await click(confirm);
    expect(text()).toContain('Escreva o motivo');
    expect(platformApi.suspend).not.toHaveBeenCalled();

    await type(container.querySelector('#suspend-reason'), '  Pagamento em atraso ');
    await click(confirm);
    expect(platformApi.suspend).toHaveBeenCalledWith('token', 'tenant-1', 'Pagamento em atraso');
    expect(text()).toContain('Motivo: Pagamento em atraso');
    expect(byText('button', 'Reativar')).toBeDefined();
  });

  it('reactivates a suspended restaurant after a confirmation', async () => {
    platformApi.detail.mockResolvedValue(detail('SUSPENDED'));
    platformApi.reactivate.mockResolvedValue(detail('TRIAL'));
    await render(TenantDetailPage);
    expect(byText('button', 'Suspender')).toBeUndefined();

    await click(byText('button', 'Reativar'));
    expect(text()).toContain('voltam a entrar com as mesmas senhas');
    expect(platformApi.reactivate).not.toHaveBeenCalled();
    const buttons = [...container.querySelectorAll('[role="dialog"] button')].filter((b) => b.textContent === 'Reativar');
    await click(buttons[0]);
    expect(platformApi.reactivate).toHaveBeenCalledWith('token', 'tenant-1');
    expect(byText('button', 'Suspender')).toBeDefined();
  });
});
