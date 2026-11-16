import { appendForwardedFor, MAX_ENTRIES, normalizeAddress } from './forwarded-for';

// What the API does with the header (Express, "trust proxy" = a number of hops): the rightmost
// entries were written by proxies; with N trusted hops, of which the API's own socket peer is
// the first, the client is the Nth entry from the right. Mirrored here so these tests state the
// property that matters: which address the API ends up believing.
function addressTheApiBelieves(forwardedFor: string, trustedHops: number): string {
  const entries = forwardedFor.split(',').map((entry) => entry.trim());
  return entries[Math.max(0, entries.length - trustedHops)];
}

describe('normalizeAddress', () => {
  it('keeps plain IPv4 and IPv6 addresses', () => {
    expect(normalizeAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeAddress('2001:db8::7')).toBe('2001:db8::7');
    expect(normalizeAddress('::1')).toBe('::1');
  });

  it('treats an IPv4 client on an IPv6 socket as the same IPv4 client', () => {
    expect(normalizeAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeAddress('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('never returns something empty: a socket with no address becomes a constant', () => {
    expect(normalizeAddress(undefined)).toBe('unknown');
    expect(normalizeAddress(null)).toBe('unknown');
    expect(normalizeAddress('')).toBe('unknown');
  });
});

describe('appendForwardedFor', () => {
  it('writes the socket address when the client sent no header', () => {
    expect(appendForwardedFor(undefined, '203.0.113.7')).toBe('203.0.113.7');
    expect(appendForwardedFor('', '203.0.113.7')).toBe('203.0.113.7');
    expect(appendForwardedFor('  ,  ', '::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('gives different clients different last entries and the same client the same one', () => {
    const first = appendForwardedFor(undefined, '203.0.113.7');
    const second = appendForwardedFor(undefined, '203.0.113.8');
    const firstAgain = appendForwardedFor(undefined, '::ffff:203.0.113.7');
    expect(addressTheApiBelieves(first, 1)).toBe('203.0.113.7');
    expect(addressTheApiBelieves(second, 1)).toBe('203.0.113.8');
    expect(addressTheApiBelieves(firstAgain, 1)).toBe(addressTheApiBelieves(first, 1));
  });

  it('keeps what arrived to the left and appends the socket address to the right', () => {
    expect(appendForwardedFor('198.51.100.1', '203.0.113.7')).toBe('198.51.100.1, 203.0.113.7');
    expect(appendForwardedFor('198.51.100.1,198.51.100.2', '203.0.113.7')).toBe(
      '198.51.100.1, 198.51.100.2, 203.0.113.7',
    );
    // Sent in several header lines: Node hands over an array.
    expect(appendForwardedFor(['198.51.100.1', '198.51.100.2'], '203.0.113.7')).toBe(
      '198.51.100.1, 198.51.100.2, 203.0.113.7',
    );
  });

  describe('a client that forges the header', () => {
    const attacker = '203.0.113.66';
    const forgeries = [
      '10.0.0.1',
      '127.0.0.1',
      '8.8.8.8, 1.1.1.1',
      '203.0.113.7',
      'unknown',
      ', , 9.9.9.9',
      Array.from({ length: 50 }, (_, i) => `198.51.100.${i}`).join(', '),
    ];

    it('is still seen by the API as its own address when the web is the only proxy', () => {
      for (const forged of forgeries) {
        expect(addressTheApiBelieves(appendForwardedFor(forged, attacker), 1)).toBe(attacker);
      }
    });

    it('cannot get a new rate-limit bucket by changing what it forges', () => {
      const believed = new Set(forgeries.map((forged) => addressTheApiBelieves(appendForwardedFor(forged, attacker), 1)));
      expect([...believed]).toEqual([attacker]);
    });

    it('cannot pass for another client that is behind the same web server', () => {
      const victim = appendForwardedFor(undefined, '203.0.113.7');
      const impostor = appendForwardedFor('203.0.113.7', attacker);
      expect(addressTheApiBelieves(victim, 1)).toBe('203.0.113.7');
      expect(addressTheApiBelieves(impostor, 1)).toBe(attacker);
    });
  });

  describe('with a proxy in front of the web (two trusted hops)', () => {
    const tlsProxy = '10.0.0.2';

    it('keeps the client the front proxy appended, and adds the proxy itself', () => {
      // The front proxy received the browser and appended it; this server sees the proxy.
      const header = appendForwardedFor('203.0.113.7', tlsProxy);
      expect(header).toBe('203.0.113.7, 10.0.0.2');
      expect(addressTheApiBelieves(header, 2)).toBe('203.0.113.7');
    });

    it('still ignores what the client forged before the front proxy', () => {
      const header = appendForwardedFor('6.6.6.6, 7.7.7.7, 203.0.113.66', tlsProxy);
      expect(addressTheApiBelieves(header, 2)).toBe('203.0.113.66');
    });
  });

  it('bounds the header: only the rightmost entries survive, and they are the ones that count', () => {
    const flood = Array.from({ length: 200 }, (_, i) => `198.51.100.${i % 250}`).join(', ');
    const header = appendForwardedFor(flood, '203.0.113.7');
    const entries = header.split(', ');
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[entries.length - 1]).toBe('203.0.113.7');
    expect(MAX_ENTRIES).toBeGreaterThan(5); // more than TRUST_PROXY_HOPS can ever be
  });
});
