'use client';

import { CSSProperties, FormEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, useAuth } from '@/lib/auth-context';
import { brandCssVars } from '@/lib/menu-display';
import { brandColorWarning, normalizeHexColor } from '@/lib/menu-admin-logic';
import {
  removeBrandImage,
  RestaurantProfileData,
  updateRestaurantProfile,
  uploadBrandImage,
} from '@/lib/restaurant-profile';
import { Alert } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input } from '@/components/ds/Input';
import { ImageChange, ImagePicker, KEEP_IMAGE } from '@/components/cardapio/ImagePicker';
import { BrandMark } from '@/components/shell/BrandMark';

// A local address for a picked file, for the preview (released when it changes).
function usePreviewUrl(change: ImageChange, current: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (change.kind !== 'replace') {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(change.file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [change]);
  return change.kind === 'replace' ? url : change.kind === 'remove' ? null : current;
}

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

// Logo, cover and main color of the public menu, with a preview of the top of the menu before
// saving. Only who has restaurant.update opens it (OWNER/ADMIN); the API checks it again.
export function BrandingDialog({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  onClose: () => void;
}) {
  const { accessToken, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [logo, setLogo] = useState<ImageChange>(KEEP_IMAGE);
  const [cover, setCover] = useState<ImageChange>(KEEP_IMAGE);
  const [color, setColor] = useState(profile.brandColor ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLogo(KEEP_IMAGE);
    setCover(KEEP_IMAGE);
    setColor(profile.brandColor ?? '');
    setError(null);
  }, [open, profile.brandColor]);

  const logoPreview = usePreviewUrl(logo, profile.logoUrl ?? null);
  const coverPreview = usePreviewUrl(cover, profile.coverUrl ?? null);
  const hex = color.trim() ? normalizeHexColor(color) : null;
  const colorInvalid = color.trim() !== '' && !hex;
  const warning = brandColorWarning(hex);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (colorInvalid) {
      setError('Cor inválida: use o formato #RRGGBB (ex.: #C8102E).');
      return;
    }
    setSaving(true);
    setError(null);
    const token = accessToken as string;
    try {
      if ((hex ?? null) !== (profile.brandColor ?? null))
        await updateRestaurantProfile(token, { brandColor: hex });
      if (logo.kind === 'replace') await uploadBrandImage(token, 'logo', logo.file);
      if (logo.kind === 'remove') await removeBrandImage(token, 'logo');
      if (cover.kind === 'replace') await uploadBrandImage(token, 'cover', cover.file);
      if (cover.kind === 'remove') await removeBrandImage(token, 'cover');
      onClose();
    } catch (err) {
      setError(messageOf(err, 'Não foi possível salvar a identidade visual.'));
    } finally {
      setSaving(false);
      // Whatever was saved shows everywhere: the profile, and the logo of the side menu.
      await queryClient.invalidateQueries({ queryKey: ['restaurant-profile'] });
      await refreshUser().catch(() => undefined);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Identidade visual do cardápio"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="branding-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="branding-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}

        <section aria-label="Prévia do topo do cardápio" className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Prévia do cardápio</span>
          <div
            className="theme-menu overflow-hidden rounded-xl border border-line bg-background"
            style={brandCssVars(hex) as CSSProperties}
          >
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="" className="aspect-[3/1] w-full object-cover" />
            ) : (
              <div className="aspect-[3/1] w-full bg-surface-2" aria-hidden />
            )}
            <div className="flex items-center gap-3 px-4 py-3">
              <BrandMark
                name={profile.name}
                logoUrl={logoPreview}
                className="-mt-8 h-14 w-14 text-lg ring-2 ring-background"
                decorative
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-foreground">{profile.name}</p>
                <p className="text-2xs text-muted-foreground">
                  Assim o cliente vê o topo do cardápio
                </p>
              </div>
              <span className="rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">
                Adicionar · R$ 32,00
              </span>
            </div>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-[auto,1fr]">
          <ImagePicker
            label="Logo"
            shape="circle"
            currentUrl={profile.logoUrl ?? null}
            value={logo}
            onChange={setLogo}
            disabled={saving}
          />
          <ImagePicker
            label="Imagem de capa"
            shape="wide"
            currentUrl={profile.coverUrl ?? null}
            value={cover}
            onChange={setCover}
            disabled={saving}
          />
        </div>

        <Field
          label="Cor principal (botões e destaques)"
          hint="Deixe em branco para usar a cor padrão do cardápio. O texto dos botões fica branco ou escuro, o que ler melhor."
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Escolher cor principal"
              value={hex ?? '#1C1917'}
              onChange={(e) => setColor(e.target.value.toUpperCase())}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-line bg-surface p-1"
            />
            <Input
              value={color}
              placeholder="#C8102E"
              maxLength={7}
              onChange={(e) => setColor(e.target.value)}
              aria-invalid={colorInvalid || undefined}
            />
            {color && (
              <Button variant="ghost" size="sm" onClick={() => setColor('')}>
                Usar padrão
              </Button>
            )}
          </div>
        </Field>
        {colorInvalid && <p className="text-xs font-medium text-danger">Use o formato #RRGGBB.</p>}
        {warning && (
          <p role="status" className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            {warning}
          </p>
        )}
      </form>
    </Dialog>
  );
}
