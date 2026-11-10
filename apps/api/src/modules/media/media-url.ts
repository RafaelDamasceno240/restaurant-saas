// Where the browser finds an image of the public menu. The web app proxies "/api/*" to this API
// (apps/web/next.config.js, docs/authentication.md), so a path on the web's own host works on
// every deployment and keeps the menu off any third-party image host. An uploaded/imported image
// (media_assets) wins over a pasted external URL.
export const PUBLIC_MEDIA_PATH = '/api/public/media';

export function publicImageUrl(mediaId: string | null, externalUrl: string | null): string | null {
  return mediaId ? `${PUBLIC_MEDIA_PATH}/${mediaId}` : externalUrl;
}
