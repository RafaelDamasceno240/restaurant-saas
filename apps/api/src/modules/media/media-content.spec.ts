import { MAX_MEDIA_BYTES, checkImage, sniffImageType } from './media-content';
import { publicImageUrl } from './media-url';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const webp = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

describe('media content', () => {
  it('recognises JPEG, PNG and WebP by their bytes only', () => {
    expect(sniffImageType(jpeg)).toBe('image/jpeg');
    expect(sniffImageType(png)).toBe('image/png');
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageType(Buffer.from('GIF89a'))).toBeNull();
  });

  it('accepts an image with its hash and size; refuses empty, too big or not an image', () => {
    const ok = checkImage(jpeg);
    expect(ok).toEqual({
      ok: true,
      contentType: 'image/jpeg',
      sizeBytes: 6,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(checkImage(Buffer.alloc(0))).toMatchObject({ ok: false });
    expect(checkImage(Buffer.concat([jpeg, Buffer.alloc(MAX_MEDIA_BYTES)]))).toMatchObject({
      ok: false,
    });
    expect(checkImage(Buffer.from('<html>'))).toMatchObject({ ok: false });
  });

  it('a stored image wins over a pasted URL, served through the web host', () => {
    expect(publicImageUrl('abc', 'https://x/y.jpg')).toBe('/api/public/media/abc');
    expect(publicImageUrl(null, 'https://x/y.jpg')).toBe('https://x/y.jpg');
    expect(publicImageUrl(null, null)).toBeNull();
  });
});
