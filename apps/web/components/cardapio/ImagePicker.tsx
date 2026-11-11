'use client';

import { useEffect, useId, useRef, useState } from 'react';
import clsx from 'clsx';
import { ImageIcon, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ds/Button';
import { imageFileProblem } from '@/lib/menu-admin-logic';

// What the form will do with the picture when saved: nothing, send a new file, or remove it.
export type ImageChange = { kind: 'keep' } | { kind: 'replace'; file: File } | { kind: 'remove' };
export const KEEP_IMAGE: ImageChange = { kind: 'keep' };

// Picks an image and shows it right away (a local preview, nothing is sent yet). The form sends it
// on "Salvar". The API checks the real bytes again; this only refuses what it would refuse anyway.
export function ImagePicker({
  label,
  currentUrl,
  value,
  onChange,
  shape = 'square',
  disabled,
}: {
  label: string;
  // The picture saved now (null: none).
  currentUrl: string | null;
  value: ImageChange;
  onChange: (change: ImageChange) => void;
  shape?: 'square' | 'circle' | 'wide';
  disabled?: boolean;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // A local URL for the picked file, released when it changes or the picker goes away.
  useEffect(() => {
    if (value.kind !== 'replace') {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(value.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const shown = value.kind === 'replace' ? previewUrl : value.kind === 'remove' ? null : currentUrl;

  function pick(file: File | undefined) {
    if (!file) return;
    const problem = imageFileProblem(file);
    setError(problem);
    if (!problem) onChange({ kind: 'replace', file });
  }

  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground" id={`${inputId}-label`}>
        {label}
      </span>
      <div className={clsx('flex gap-3', shape === 'wide' ? 'flex-col' : 'items-center')}>
        <div
          className={clsx(
            'flex shrink-0 items-center justify-center overflow-hidden border border-line bg-surface-2 text-subtle',
            shape === 'circle' && 'h-20 w-20 rounded-full',
            shape === 'square' && 'h-20 w-20 rounded-lg',
            shape === 'wide' && 'aspect-[3/1] w-full rounded-lg',
          )}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown}
              alt={value.kind === 'replace' ? `Prévia: ${label}` : label}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageIcon className="h-6 w-6" aria-hidden />
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<Upload className="h-3.5 w-3.5" />}
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              aria-describedby={`${inputId}-label`}
            >
              {shown ? 'Trocar imagem' : 'Escolher imagem'}
            </Button>
            {(shown || value.kind === 'remove') && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => {
                  setError(null);
                  if (inputRef.current) inputRef.current.value = '';
                  // A picked file is discarded (back to the saved picture); the saved one is
                  // marked for removal; a pending removal is undone.
                  onChange(value.kind === 'keep' ? { kind: 'remove' } : KEEP_IMAGE);
                }}
                disabled={disabled}
              >
                {value.kind === 'remove'
                  ? 'Desfazer remoção'
                  : value.kind === 'replace'
                    ? 'Descartar'
                    : 'Remover'}
              </Button>
            )}
          </div>
          <p className="text-2xs text-subtle">
            {value.kind === 'replace'
              ? 'Prévia: a imagem só é enviada quando você salvar.'
              : value.kind === 'remove'
                ? 'A imagem será removida quando você salvar.'
                : 'JPEG, PNG ou WebP, até 3 MB.'}
          </p>
          {error && (
            <p role="alert" className="text-2xs font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={`${inputId}-label`}
        onChange={(e) => pick(e.target.files?.[0])}
      />
    </div>
  );
}
