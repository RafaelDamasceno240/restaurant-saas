/**
 * @jest-environment node
 */
import { bakedApiUrl, checkApiUrl } from './api-url-guard';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../next.config.js') as ((phase: string) => unknown) & {
  requireApiUrlForBuild: (phase: string, env: Record<string, string | undefined>) => void;
};

const manifestFor = (destination: string) => ({
  version: 3,
  rewrites: {
    beforeFiles: [],
    afterFiles: [{ source: '/api/:path*', destination, regex: '' }],
    fallback: [],
  },
});

describe('bakedApiUrl', () => {
  it('reads the /api destination of a build, in every manifest shape', () => {
    expect(bakedApiUrl(manifestFor('http://127.0.0.1:4700/v1/:path*'))).toBe(
      'http://127.0.0.1:4700/v1',
    );
    expect(
      bakedApiUrl({
        rewrites: [{ source: '/api/:path*', destination: 'https://api.x/v1/:path*' }],
      }),
    ).toBe('https://api.x/v1');
    expect(bakedApiUrl({ rewrites: [] })).toBeNull();
    expect(bakedApiUrl(null)).toBeNull();
  });
});

describe('checkApiUrl (web server start)', () => {
  it('starts when API_URL is the address the build was made for', () => {
    expect(
      checkApiUrl({
        runtimeApiUrl: 'http://127.0.0.1:4700/v1/',
        manifest: manifestFor('http://127.0.0.1:4700/v1/:path*'),
      }),
    ).toEqual({ ok: true, apiUrl: 'http://127.0.0.1:4700/v1' });
  });

  it('refuses a build made for another API (the case that pointed a test web at another environment)', () => {
    const result = checkApiUrl({
      runtimeApiUrl: 'http://127.0.0.1:4700/v1',
      manifest: manifestFor('http://localhost:4000/v1/:path*'),
    });
    expect(result).toEqual({
      ok: false,
      message: expect.stringMatching(/localhost:4000.*4700.*Recompile/),
    });
  });

  it('refuses to start without API_URL or without a build', () => {
    expect(
      checkApiUrl({ runtimeApiUrl: undefined, manifest: manifestFor('http://a/v1/:path*') }).ok,
    ).toBe(false);
    expect(
      checkApiUrl({ runtimeApiUrl: '  ', manifest: manifestFor('http://a/v1/:path*') }).ok,
    ).toBe(false);
    expect(checkApiUrl({ runtimeApiUrl: 'http://a/v1', manifest: null }).ok).toBe(false);
  });
});

describe('next.config.js (build)', () => {
  it('a production build needs API_URL; development keeps its localhost default', () => {
    const { requireApiUrlForBuild } = nextConfig;
    expect(() => requireApiUrlForBuild('phase-production-build', {})).toThrow(
      /API_URL is required/,
    );
    expect(() =>
      requireApiUrlForBuild('phase-production-build', { API_URL: 'http://a/v1' }),
    ).not.toThrow();
    expect(() => requireApiUrlForBuild('phase-development-server', {})).not.toThrow();
    expect(() => requireApiUrlForBuild('phase-production-server', { VERCEL: '1' })).toThrow();
  });

  it('fails where the proxy is written (rewrites), so lint and type checks still load the config', async () => {
    const saved = process.env.API_URL;
    delete process.env.API_URL;
    try {
      type Config = { rewrites: () => Promise<{ source: string; destination: string }[]> };
      const build = nextConfig('phase-production-build') as Config;
      await expect(build.rewrites()).rejects.toThrow(/API_URL is required/);
      const dev = nextConfig('phase-development-server') as Config;
      await expect(dev.rewrites()).resolves.toEqual([
        { source: '/api/:path*', destination: expect.stringMatching(/\/:path\*$/) },
      ]);
    } finally {
      if (saved === undefined) delete process.env.API_URL;
      else process.env.API_URL = saved;
    }
  });
});
