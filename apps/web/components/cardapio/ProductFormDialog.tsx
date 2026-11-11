'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Info, X } from 'lucide-react';
import { ApiError } from '@/lib/auth-context';
import { Category, OptionGroup, Product, productsApi } from '@/lib/cardapio-api';
import { productPriceProblem } from '@/lib/money';
import { groupRuleLabel, moveItem, parseMoney, promoPriceProblem } from '@/lib/menu-admin-logic';
import { Alert } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ds/Input';
import { Switch } from '@/components/ds/Switch';
import { ImageChange, ImagePicker, KEEP_IMAGE } from './ImagePicker';

interface FormState {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  compareAtPrice: string;
  imageUrl: string;
  displayOrder: number;
  active: boolean;
  soldOut: boolean;
  featured: boolean;
  groupIds: string[];
}

const priceText = (value: number | null) =>
  value === null ? '' : value.toFixed(2).replace('.', ',');

function formFrom(product: Product | null, categoryId: string): FormState {
  return {
    categoryId: product?.categoryId ?? categoryId,
    name: product?.name ?? '',
    description: product?.description ?? '',
    price: product ? priceText(product.price) : '',
    compareAtPrice: product ? priceText(product.compareAtPrice) : '',
    imageUrl: product?.imageUrl ?? '',
    displayOrder: product?.displayOrder ?? 0,
    active: product?.active ?? true,
    soldOut: product?.soldOut ?? false,
    featured: product?.featured ?? false,
    groupIds: product?.optionGroupIds ?? [],
  };
}

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

// Create or edit one product: data, prices, availability, photo and add-on groups. Saving is a few
// calls in a row (data, then photo, then groups); if a later one fails, what was saved stays saved
// and the dialog keeps the product, so "Salvar" again only retries what is missing.
export function ProductFormDialog({
  open,
  product,
  categoryId,
  categories,
  groups,
  accessToken,
  onClose,
  onSaved,
}: {
  open: boolean;
  // null: a new product, in `categoryId`.
  product: Product | null;
  categoryId: string;
  categories: Category[];
  groups: OptionGroup[];
  accessToken: string;
  onClose: () => void;
  // complete = false: saved in part (the dialog stays open with the error).
  onSaved: (product: Product, created: boolean, complete: boolean) => void;
}) {
  const [saved, setSaved] = useState<Product | null>(product);
  const [form, setForm] = useState<FormState>(() => formFrom(product, categoryId));
  const [photo, setPhoto] = useState<ImageChange>(KEEP_IMAGE);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A new opening starts from the product (or the empty form) again.
  useEffect(() => {
    if (!open) return;
    setSaved(product);
    setForm(formFrom(product, categoryId));
    setPhoto(KEEP_IMAGE);
    setError(null);
  }, [open, product, categoryId]);

  const groupsById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const available = groups.filter((g) => !form.groupIds.includes(g.id));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const hasUpload = !!saved?.hasUploadedPhoto;
  const currentPhoto = hasUpload ? saved!.photoUrl : form.imageUrl.trim() || null;
  const showLinkField = !hasUpload && photo.kind === 'keep';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem =
      productPriceProblem(form.price) ??
      promoPriceProblem(form.price, form.compareAtPrice) ??
      (form.imageUrl.trim() && showLinkField && !/^https?:\/\/\S+$/i.test(form.imageUrl.trim())
        ? 'O link da imagem deve começar com http:// ou https://.'
        : null);
    setError(problem);
    if (problem) return;

    setSaving(true);
    const created = !saved;
    let current = saved;
    try {
      const input = {
        categoryId: form.categoryId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: parseMoney(form.price)!,
        compareAtPrice: form.compareAtPrice.trim() ? parseMoney(form.compareAtPrice) : null,
        imageUrl:
          photo.kind === 'remove' ? null : showLinkField ? form.imageUrl.trim() || null : undefined,
        displayOrder: Number(form.displayOrder) || 0,
        active: form.active,
        soldOut: form.soldOut,
        featured: form.featured,
      };
      if (current && photo.kind === 'remove')
        current = await productsApi.removePhoto(accessToken, current.id);
      current = current
        ? await productsApi.update(accessToken, current.id, input)
        : await productsApi.create(accessToken, input);
      setSaved(current);
      if (photo.kind === 'replace') {
        current = await productsApi.uploadPhoto(accessToken, current.id, photo.file);
        setSaved(current);
      }
      setPhoto(KEEP_IMAGE);
      if (form.groupIds.join() !== current.optionGroupIds.join()) {
        current = await productsApi.setOptionGroups(accessToken, current.id, form.groupIds);
        setSaved(current);
      }
      onSaved(current, created, true);
    } catch (err) {
      const message = messageOf(err, 'Não foi possível salvar o produto.');
      setError(
        current
          ? `O produto foi salvo, mas uma parte falhou: ${message} Tente salvar de novo.`
          : message,
      );
      if (current) onSaved(current, created, false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={saved ? 'Editar produto' : 'Novo produto'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="product-form" loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {saved?.imported && (
          <p className="flex gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Produto importado de outra plataforma. O que você mudar aqui fica protegido: uma nova
            importação não desfaz suas edições.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome">
            <Input
              required
              autoFocus
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Categoria">
            <Select
              required
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Descrição (opcional)">
          <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Preço de venda (R$)">
            <Input
              inputMode="decimal"
              required
              placeholder="0,00"
              value={form.price}
              onChange={(e) => set('price', e.target.value)}
            />
          </Field>
          <Field
            label='Preço "de" (promoção, opcional)'
            hint="Aparece riscado ao lado do preço de venda."
          >
            <Input
              inputMode="decimal"
              placeholder="ex.: 35,00"
              value={form.compareAtPrice}
              onChange={(e) => set('compareAtPrice', e.target.value)}
            />
          </Field>
        </div>

        <fieldset className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-3">
          <legend className="px-1 text-xs font-medium text-muted-foreground">
            Disponibilidade
          </legend>
          <ToggleRow
            label="Visível no cardápio"
            hint="Desligado: o produto some do cardápio."
            checked={form.active}
            onChange={(v) => set('active', v)}
          />
          <ToggleRow
            label="Esgotado"
            hint="Aparece, mas não pode ser pedido."
            checked={form.soldOut}
            onChange={(v) => set('soldOut', v)}
          />
          <ToggleRow
            label="Destaque"
            hint="Também aparece em “Destaques”."
            checked={form.featured}
            onChange={(v) => set('featured', v)}
          />
        </fieldset>

        <ImagePicker
          label="Foto do produto"
          currentUrl={currentPhoto}
          value={photo}
          onChange={setPhoto}
          disabled={saving}
        />
        {showLinkField && (
          <Field
            label="Ou link de uma imagem (opcional)"
            hint="Use se a foto já estiver publicada em outro site."
          >
            <Input
              placeholder="https://..."
              value={form.imageUrl}
              onChange={(e) => set('imageUrl', e.target.value)}
            />
          </Field>
        )}

        <section className="space-y-2" aria-labelledby="product-groups-title">
          <div className="flex items-baseline justify-between gap-2">
            <h3 id="product-groups-title" className="text-xs font-medium text-muted-foreground">
              Adicionais deste produto
            </h3>
            <span className="text-2xs text-subtle">na ordem em que o cliente vê</span>
          </div>
          {form.groupIds.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-subtle">
              Nenhum grupo de adicionais. Crie grupos na aba “Adicionais”.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {form.groupIds.map((id, index) => {
                const g = groupsById.get(id);
                return (
                  <li key={id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">
                        {g?.name ?? 'Grupo removido'}
                      </span>
                      {g && (
                        <span className="text-2xs text-subtle">
                          {groupRuleLabel(g.minSelect, g.maxSelect)} · {g.options.length} opç
                          {g.options.length === 1 ? 'ão' : 'ões'}
                        </span>
                      )}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Subir ${g?.name ?? 'grupo'}`}
                      disabled={index === 0}
                      onClick={() => set('groupIds', moveItem(form.groupIds, index, -1))}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Descer ${g?.name ?? 'grupo'}`}
                      disabled={index === form.groupIds.length - 1}
                      onClick={() => set('groupIds', moveItem(form.groupIds, index, 1))}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Tirar ${g?.name ?? 'grupo'} deste produto`}
                      onClick={() =>
                        set(
                          'groupIds',
                          form.groupIds.filter((x) => x !== id),
                        )
                      }
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {available.length > 0 && (
            <Select
              aria-label="Adicionar grupo de adicionais"
              value=""
              onChange={(e) =>
                e.target.value && set('groupIds', [...form.groupIds, e.target.value])
              }
            >
              <option value="">+ Adicionar grupo de adicionais…</option>
              {available.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({groupRuleLabel(g.minSelect, g.maxSelect)})
                </option>
              ))}
            </Select>
          )}
        </section>

        <Field
          label="Ordem de exibição"
          hint="Também dá para mudar com as setas na lista de produtos."
        >
          <Input
            type="number"
            min={0}
            value={form.displayOrder}
            onChange={(e) => set('displayOrder', Number(e.target.value))}
          />
        </Field>
      </form>
    </Dialog>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-2xs text-subtle">{hint}</span>
      </span>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}
