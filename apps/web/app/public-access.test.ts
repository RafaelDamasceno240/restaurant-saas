import { act, createElement as h } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import HomePage from './page';
import LoginPage from './login/page';
import RegisterPage from './register/page';

// 2026-10-28: no public sign-up. The public side of the app is the login and nothing else; the
// old /register address only explains that access is granted by the team. Plain react-dom, no
// JSX: Jest here only picks up *.test.ts.

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../lib/auth-context', () => ({
  useAuth: () => ({ login: jest.fn() }),
  ApiError: class ApiError extends Error {},
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIGN_UP_WORDS = /criar conta|criar restaurante|cadastre-se|cadastrar restaurante|registrar|começar grátis|comece grátis|sign ?up/i;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(component: () => unknown) {
  act(() => root.render(h(component as never)));
  return {
    text: container.textContent ?? '',
    hrefs: [...container.querySelectorAll('a')].map((a) => a.getAttribute('href')),
  };
}

describe('public pages without sign-up', () => {
  it('the login page has e-mail, password and "Entrar", and nothing to create an account', () => {
    const { text, hrefs } = render(LoginPage);
    const inputs = [...container.querySelectorAll('input')].map((i) => i.getAttribute('type'));

    expect(inputs).toEqual(['email', 'password']);
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Entrar']);
    expect(text).not.toMatch(SIGN_UP_WORDS);
    expect(hrefs).not.toContain('/register');
  });

  it('the landing page only offers "Entrar"', () => {
    const { text, hrefs } = render(HomePage);

    expect(hrefs).toEqual(['/login']);
    expect(text).not.toMatch(SIGN_UP_WORDS);
  });

  it('the old /register address shows no form, says access is granted by the team and leads back to the login', () => {
    const { text, hrefs } = render(RegisterPage);

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelectorAll('input, textarea, select, button')).toHaveLength(0);
    expect(text).toContain('Novos acessos são liberados diretamente pela equipe responsável.');
    expect(hrefs).toEqual(['/login']);
    expect([...container.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Voltar para o login']);
  });
});

describe('nothing in the web app reaches a sign-up', () => {
  // Every source file of the app, read as text: a link or a call left anywhere fails here.
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx|js)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
  const files = ['app', 'components', 'lib'].flatMap((dir) => sources(join(__dirname, '..', dir)));

  it('no link to /register and no call to the removed /auth/register', () => {
    const offenders = files.filter((file) => {
      const code = readFileSync(file, 'utf8');
      return /href=["'{`]*\/register|['"`]\/(v1\/)?auth\/register|\/auth\/sign-?up/.test(code);
    });
    expect(files.length).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });

  it('no NEXT_PUBLIC variable turns a sign-up on', () => {
    const offenders = files.filter((file) => /NEXT_PUBLIC_[A-Z_]*(SIGN|REGIST|CADASTR)/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
