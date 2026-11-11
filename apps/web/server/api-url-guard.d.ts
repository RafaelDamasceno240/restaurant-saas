export function bakedApiUrl(manifest: unknown): string | null;
export function checkApiUrl(input: {
  runtimeApiUrl: string | undefined;
  manifest: unknown;
}): { ok: true; apiUrl: string } | { ok: false; message: string };
