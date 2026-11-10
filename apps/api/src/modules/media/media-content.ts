import { createHash } from 'crypto';

// Images accepted for the public menu: the three formats every browser shows, recognised by
// their first bytes (never by a file name or a declared type), up to 3 MiB (the database CHECK
// media_assets_size holds the same limit).
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

export type MediaContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export function sniffImageType(bytes: Buffer): MediaContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export type MediaCheck =
  | { ok: true; contentType: MediaContentType; sha256: string; sizeBytes: number }
  | { ok: false; reason: string };

export function checkImage(bytes: Buffer): MediaCheck {
  if (bytes.length === 0) return { ok: false, reason: 'arquivo vazio' };
  if (bytes.length > MAX_MEDIA_BYTES)
    return { ok: false, reason: `maior que ${MAX_MEDIA_BYTES / 1024 / 1024} MB` };
  const contentType = sniffImageType(bytes);
  if (!contentType) return { ok: false, reason: 'não é uma imagem JPEG, PNG ou WebP' };
  return {
    ok: true,
    contentType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
}
