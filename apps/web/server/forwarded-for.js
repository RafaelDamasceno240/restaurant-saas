'use strict';

// The browser reaches the API through this server (the /api rewrite of next.config.js). The API
// needs the browser's address for its rate limits, its audit trail and refresh_tokens.ip, and
// Next's rewrite does not provide it: it passes X-Forwarded-For through exactly as the client
// sent it, or sends none.
//
// So this server does what any reverse proxy does: it APPENDS the address of whoever is on the
// other end of the socket. It never replaces, trusts or interprets what arrived:
//   - what the client wrote stays to the LEFT and is worthless: the API counts
//     TRUST_PROXY_HOPS entries from the RIGHT, and those were written by proxies;
//   - a proxy in front of this server (a TLS terminator, a platform load balancer) appended the
//     real client before us, and we append that proxy: the chain stays in order.
// The API's TRUST_PROXY_HOPS is then the number of proxies between the browser and the API,
// this server included. See docs/authentication.md, "Endereço do cliente".

// More than the API can ever be told to trust (TRUST_PROXY_HOPS goes up to 5), and a bound on
// what one request can make us forward.
const MAX_ENTRIES = 10;

// An IPv4 client on a dual-stack socket shows up as '::ffff:203.0.113.7': the same client as
// '203.0.113.7', and it must land in the same rate-limit bucket. A socket with no address
// (already destroyed) becomes a constant, never something the client chose.
function normalizeAddress(address) {
  if (typeof address !== 'string' || address.length === 0) return 'unknown';
  return address.startsWith('::ffff:') && address.includes('.') ? address.slice('::ffff:'.length) : address;
}

// `received` is the X-Forwarded-For header as Node parsed it (a string, an array when it came
// in several lines, or undefined). Returns the header to send on.
function appendForwardedFor(received, remoteAddress) {
  const text = Array.isArray(received) ? received.join(',') : typeof received === 'string' ? received : '';
  const entries = text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  entries.push(normalizeAddress(remoteAddress));
  return entries.slice(-MAX_ENTRIES).join(', ');
}

module.exports = { MAX_ENTRIES, appendForwardedFor, normalizeAddress };
