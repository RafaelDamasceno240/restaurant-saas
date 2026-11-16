'use strict';

// The browser reaches the API through the /api rewrite, and `next build` writes that rewrite's
// destination into .next/routes-manifest.json: the API address is fixed at BUILD time. A web built
// with one API_URL and started with another (or with none, which made the build fall back to
// localhost:4000) silently talks to the wrong API, possibly another environment's. So the server
// refuses to start unless API_URL is set and is the address the build was made for.

const REWRITE_SOURCE = '/api/:path*';
const PATH_SUFFIX = '/:path*';

const normalize = (url) => String(url).trim().replace(/\/+$/, '');

// The API address baked into a build, from its routes manifest (null when there is no /api rewrite).
function bakedApiUrl(manifest) {
  const rewrites = manifest && manifest.rewrites;
  const list = Array.isArray(rewrites)
    ? rewrites
    : rewrites
      ? [
          ...(rewrites.beforeFiles || []),
          ...(rewrites.afterFiles || []),
          ...(rewrites.fallback || []),
        ]
      : [];
  const rule = list.find((r) => r && r.source === REWRITE_SOURCE);
  if (!rule || typeof rule.destination !== 'string') return null;
  return rule.destination.endsWith(PATH_SUFFIX)
    ? normalize(rule.destination.slice(0, -PATH_SUFFIX.length))
    : normalize(rule.destination);
}

// { ok: true, apiUrl } or { ok: false, message } (the message says what to do).
function checkApiUrl({ runtimeApiUrl, manifest }) {
  if (!runtimeApiUrl || !String(runtimeApiUrl).trim()) {
    return {
      ok: false,
      message:
        'API_URL não está definido. Defina o endereço da API deste ambiente (com /v1), o mesmo usado no build.',
    };
  }
  const baked = bakedApiUrl(manifest);
  if (!baked) {
    return {
      ok: false,
      message:
        'O build não tem o proxy /api (routes-manifest sem a regra). Rode "next build" com API_URL definido.',
    };
  }
  const runtime = normalize(runtimeApiUrl);
  if (baked !== runtime) {
    return {
      ok: false,
      message: `Este build aponta para ${baked}, mas API_URL é ${runtime}. Recompile com API_URL=${runtime} (o endereço fica gravado no build).`,
    };
  }
  return { ok: true, apiUrl: runtime };
}

module.exports = { bakedApiUrl, checkApiUrl };
