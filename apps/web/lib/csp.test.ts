/**
 * @jest-environment node
 */
import { buildContentSecurityPolicy, createNonce } from './csp';

function parse(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name, values];
    }),
  );
}

describe('buildContentSecurityPolicy (production)', () => {
  const policy = parse(buildContentSecurityPolicy({ nonce: 'abc123', isDev: false }));

  it('only runs scripts carrying the request nonce', () => {
    expect(policy['script-src']).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
  });

  it('never allows inline or evaluated scripts', () => {
    expect(policy['script-src']).not.toContain("'unsafe-inline'");
    expect(policy['script-src']).not.toContain("'unsafe-eval'");
  });

  it('lets the page talk to its own origin only', () => {
    expect(policy['connect-src']).toEqual(["'self'"]);
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
  });

  it('cannot be framed and embeds no plugins', () => {
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
  });

  it('accepts images from https origins, never plain http', () => {
    expect(policy['img-src']).toContain('https:');
    expect(policy['img-src']).not.toContain('http:');
  });

  it('has no wildcard source anywhere', () => {
    for (const values of Object.values(policy)) expect(values).not.toContain('*');
  });
});

describe('buildContentSecurityPolicy (development)', () => {
  const policy = parse(buildContentSecurityPolicy({ nonce: 'abc123', isDev: true }));

  it('adds only what the dev server needs', () => {
    expect(policy['script-src']).toContain("'unsafe-eval'");
    expect(policy['script-src']).not.toContain("'unsafe-inline'");
    expect(policy['connect-src']).toEqual(["'self'", 'ws:', 'wss:']);
  });
});

describe('createNonce', () => {
  it('is base64, long enough and different every time', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createNonce()));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    }
  });
});
