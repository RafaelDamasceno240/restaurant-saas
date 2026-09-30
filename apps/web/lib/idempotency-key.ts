function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cryptoKey(): string | null {
  try {
    const webCrypto = globalThis.crypto;
    if (typeof webCrypto?.randomUUID === 'function') {
      return webCrypto.randomUUID();
    }
    if (typeof webCrypto?.getRandomValues === 'function') {
      return uuidFromBytes(webCrypto.getRandomValues(new Uint8Array(16)));
    }
    return null;
  } catch {
    return null;
  }
}

function mathRandomKey(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}

export function createIdempotencyKey(): string {
  return cryptoKey() ?? mathRandomKey();
}
