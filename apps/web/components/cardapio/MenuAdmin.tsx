'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CircleSlash,
  Copy,
  ImageIcon,
  Pause,
  Pencil,
  Play,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { useAuth, ApiError } from '@/lib/auth-context';
import {
  categoriesApi,
  Category,
  optionGroupsApi,
  productsApi,
  Product,
} from '@/lib/cardapio-api';
import { formatBRL } from '@/lib/format';
import { moveItem } from '@/lib/menu-admin-logic';
import { hasPermission } from '@/lib/permissions';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { ConfirmDialog, Dialog } from '@/components/ds/Dialog';
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ds/Input';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tooltip } from '@/components/ds/Tooltip';
import { useToast } from '@/components/ds/Toast';
import { ProductFormDialog } from './ProductFormDialog';

const emptyCategoryForm = { name: '', description: '', displayOrder: 0 };

type CategoryDialog = { mode: 'create' } | { mode: 'edit'; category: Category } | null;
type ProductDialog = { product: Product | null; categoryId: string } | null;
type DeleteTarget = { kind: 'category'; category: Category } | { kind: 'product'; product: Product } | null;

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export const MENU_ADMIN_KEY = ['menu-admin'];

// Presentation of the cardápio admin: one section per category with a dense product table.
// Everything the public menu shows is edited here: prices and promotion, photo, availability
// (visible / sold out), highlight, order and the add-on groups of each product.
export function MenuAdmin({ onCategoryCount }: { onCategoryCount?: (n: number) => void }) {
  const { accessToken, user } = useAuth();
  // B12: a cashier, a waiter or a viewer reads the menu (products.read) without the buttons that
  // change it; deleting stays with OWNER/ADMIN (products.delete, categories.delete), like the API.
  const roles = user?.roles;
  const canCreateCategory = hasPermission(roles, 'categories.create');
  const canUpdateCategory = hasPermission(roles, 'categories.update');
  const canDeleteCategory = hasPermission(roles, 'categories.delete');
  const canCreateProduct = hasPermission(roles, 'products.create');
  const canUpdateProduct = hasPermission(roles, 'products.update');
  const canDeleteProduct = hasPermission(roles, 'products.delete');
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog>(null);
  const [productDialog, setProductDialog] = useState<ProductDialog>(null);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const categoriesQuery = useQuery({
    queryKey: [...MENU_ADMIN_KEY, 'categories'],
    queryFn: async () => {
      const list = await categoriesApi.list(accessToken as string);
      onCategoryCount?.(list.length);
      return list;
    },
    enabled: !!accessToken,
  });
  const productsQuery = useQuery({
    queryKey: [...MENU_ADMIN_KEY, 'products'],
    queryFn: () => productsApi.list(accessToken as string),
    enabled: !!accessToken,
  });
  const groupsQuery = useQuery({
    queryKey: [...MENU_ADMIN_KEY, 'option-groups'],
    queryFn: () => optionGroupsApi.list(accessToken as string),
    enabled: !!accessToken,
  });

  const categories = useMemo(
    () => [...(categoriesQuery.data ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [categoriesQuery.data],
  );
  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  const term = search.trim().toLowerCase();
  const sections = useMemo(
    () =>
      categories
        .filter((c) => !categoryFilter || c.id === categoryFilter)
        .map((category) => {
          const all = products
            .filter((p) => p.categoryId === category.id)
            .sort((a, b) => a.displayOrder - b.displayOrder);
          const shown = term ? all.filter((p) => p.name.toLowerCase().includes(term)) : all;
          return { category, all, shown };
        })
        // While searching, hide categories with no match.
        .filter((s) => !term || s.shown.length > 0),
    [categories, products, categoryFilter, term],
  );

  function refresh() {
    return queryClient.invalidateQueries({ queryKey: MENU_ADMIN_KEY });
  }

  // ---- mutations ----------------------------------------------------------

  const saveCategory = useMutation({
    mutationFn: async () => {
      const input = {
        name: categoryForm.name,
        description: categoryForm.description || undefined,
        displayOrder: Number(categoryForm.displayOrder) || 0,
      };
      if (categoryDialog?.mode === 'edit') {
        return categoriesApi.update(accessToken as string, categoryDialog.category.id, input);
      }
      return categoriesApi.create(accessToken as string, input);
    },
    onSuccess: async () => {
      toast.success(categoryDialog?.mode === 'edit' ? 'Categoria atualizada.' : 'Categoria criada.');
      setCategoryDialog(null);
      await refresh();
    },
    onError: (err) => setFormError(messageOf(err, 'Não foi possível salvar a categoria.')),
  });

  const toggleCategory = useMutation({
    mutationFn: (category: Category) =>
      categoriesApi.update(accessToken as string, category.id, { active: !category.active }),
    onSuccess: async (_r, category) => {
      toast.success(category.active ? 'Categoria pausada.' : 'Categoria ativada.');
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível atualizar a categoria.')),
  });

  const moveCategory = useMutation({
    mutationFn: ({ index, delta }: { index: number; delta: -1 | 1 }) =>
      categoriesApi.reorder(
        accessToken as string,
        moveItem(categories, index, delta).map((c) => c.id),
      ),
    onSuccess: () => refresh(),
    onError: async (err) => {
      toast.error(messageOf(err, 'Não foi possível mudar a ordem.'));
      await refresh();
    },
  });

  // Quick switches from the list: visible/paused, sold out, highlight.
  const quickUpdate = useMutation({
    mutationFn: ({ product, patch }: { product: Product; patch: Partial<Product>; message: string }) =>
      productsApi.update(accessToken as string, product.id, patch),
    onSuccess: async (_r, { message }) => {
      toast.success(message);
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível atualizar o produto.')),
  });

  const moveProduct = useMutation({
    mutationFn: ({ list, index, delta }: { list: Product[]; index: number; delta: -1 | 1 }) =>
      productsApi.reorder(
        accessToken as string,
        list[0].categoryId,
        moveItem(list, index, delta).map((p) => p.id),
      ),
    onSuccess: () => refresh(),
    onError: async (err) => {
      toast.error(messageOf(err, 'Não foi possível mudar a ordem.'));
      await refresh();
    },
  });

  const duplicateProduct = useMutation({
    mutationFn: (product: Product) => productsApi.duplicate(accessToken as string, product.id),
    onSuccess: async () => {
      toast.success('Produto duplicado, com foto, promoção e adicionais.');
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível duplicar o produto.')),
  });

  const remove = useMutation({
    mutationFn: async (target: NonNullable<DeleteTarget>) => {
      if (target.kind === 'category') return categoriesApi.remove(accessToken as string, target.category.id);
      return productsApi.remove(accessToken as string, target.product.id);
    },
    onSuccess: async (_r, target) => {
      toast.success(target.kind === 'category' ? 'Categoria excluída.' : 'Produto excluído.');
      setDeleteTarget(null);
      await refresh();
    },
    onError: (err, target) => {
      setDeleteTarget(null);
      toast.error(
        messageOf(err, target.kind === 'category' ? 'Não foi possível excluir a categoria.' : 'Não foi possível excluir o produto.'),
      );
    },
  });

  // ---- dialog openers -----------------------------------------------------

  function openCreateCategory() {
    setFormError(null);
    setCategoryForm(emptyCategoryForm);
    setCategoryDialog({ mode: 'create' });
  }

  function openEditCategory(category: Category) {
    setFormError(null);
    setCategoryForm({
      name: category.name,
      description: category.description ?? '',
      displayOrder: category.displayOrder,
    });
    setCategoryDialog({ mode: 'edit', category });
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    saveCategory.mutate();
  }

  // ---- render -------------------------------------------------------------

  const isLoading = categoriesQuery.isLoading || productsQuery.isLoading;
  const isError = categoriesQuery.isError || productsQuery.isError;
  const reordering = moveProduct.isPending || moveCategory.isPending;
  // Reordering works on the whole list: not while it is filtered.
  const canReorder = canUpdateProduct && !term;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <SearchInput
            placeholder="Buscar produto..."
            aria-label="Buscar produto"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-full sm:w-56">
          <Select
            aria-label="Filtrar por categoria"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        {canCreateCategory && (
          <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={openCreateCategory}>
            Nova categoria
          </Button>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Carregando cardápio..." />
      ) : isError ? (
        <ErrorState
          message="Não foi possível carregar o cardápio."
          onRetry={() => {
            categoriesQuery.refetch();
            productsQuery.refetch();
          }}
        />
      ) : categories.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title="Seu cardápio está vazio"
          description={
            canCreateCategory
              ? 'Comece criando uma categoria (ex.: Burgers, Bebidas) e depois adicione os produtos.'
              : 'O responsável pelo restaurante ainda não cadastrou o cardápio.'
          }
          action={
            canCreateCategory ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={openCreateCategory}>
                Nova categoria
              </Button>
            ) : undefined
          }
        />
      ) : sections.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="Nenhum produto encontrado" description="Ajuste a busca ou o filtro." />
      ) : (
        sections.map(({ category, all, shown }) => {
          const categoryIndex = categories.findIndex((c) => c.id === category.id);
          return (
            <Card key={category.id} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Badge tone={category.active ? 'success' : 'neutral'} dot>
                    {category.active ? 'Ativa' : 'Pausada'}
                  </Badge>
                  <h2 className="truncate text-sm font-semibold text-foreground">{category.name}</h2>
                  <span className="text-xs text-subtle">
                    ({all.length} produto{all.length === 1 ? '' : 's'})
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {canUpdateCategory && !categoryFilter && (
                    <>
                      <Tooltip label="Subir categoria">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Subir categoria ${category.name}`}
                          disabled={categoryIndex <= 0 || reordering}
                          onClick={() => moveCategory.mutate({ index: categoryIndex, delta: -1 })}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                      <Tooltip label="Descer categoria">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Descer categoria ${category.name}`}
                          disabled={categoryIndex === categories.length - 1 || reordering}
                          onClick={() => moveCategory.mutate({ index: categoryIndex, delta: 1 })}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </>
                  )}
                  {canUpdateCategory && (
                    <Tooltip label={category.active ? 'Pausar categoria' : 'Ativar categoria'}>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={category.active ? `Pausar categoria ${category.name}` : `Ativar categoria ${category.name}`}
                        onClick={() => toggleCategory.mutate(category)}
                        disabled={toggleCategory.isPending}
                      >
                        {category.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                    </Tooltip>
                  )}
                  {canUpdateCategory && (
                    <Tooltip label="Editar categoria">
                      <Button variant="ghost" size="icon-sm" aria-label={`Editar categoria ${category.name}`} onClick={() => openEditCategory(category)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </Tooltip>
                  )}
                  {canDeleteCategory && (
                    <Tooltip label="Excluir categoria">
                      <Button
                        variant="danger-ghost"
                        size="icon-sm"
                        aria-label={`Excluir categoria ${category.name}`}
                        onClick={() => setDeleteTarget({ kind: 'category', category })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </Tooltip>
                  )}
                  {canCreateProduct && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-2"
                      icon={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => setProductDialog({ product: null, categoryId: category.id })}
                    >
                      Adicionar produto
                    </Button>
                  )}
                </div>
              </div>

              {shown.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  Nenhum produto nesta categoria ainda.
                </p>
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <tr>
                        <Th>Produto</Th>
                        <Th className="w-44">Status</Th>
                        <Th className="w-32">Preço</Th>
                        <Th className="w-64 text-right">Ações</Th>
                      </tr>
                    </THead>
                    <TBody>
                      {shown.map((product, index) => (
                        <Tr key={product.id}>
                          <Td>
                            <div className="flex items-center gap-3">
                              {product.photoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={product.photoUrl}
                                  alt=""
                                  loading="lazy"
                                  className="h-10 w-10 shrink-0 rounded-md border border-line object-cover"
                                />
                              ) : (
                                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-subtle">
                                  <ImageIcon className="h-4 w-4" aria-hidden />
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">{product.name}</p>
                                {product.description && (
                                  <p className="max-w-xs truncate text-xs text-subtle">{product.description}</p>
                                )}
                                {product.optionGroupIds.length > 0 && (
                                  <p className="text-2xs text-subtle">
                                    {product.optionGroupIds.length} grupo
                                    {product.optionGroupIds.length === 1 ? '' : 's'} de adicionais
                                  </p>
                                )}
                              </div>
                            </div>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              {!product.active ? (
                                <Badge tone="neutral" dot>
                                  Pausado
                                </Badge>
                              ) : product.soldOut ? (
                                <Badge tone="warning" dot>
                                  Esgotado
                                </Badge>
                              ) : (
                                <Badge tone="success" dot>
                                  Disponível
                                </Badge>
                              )}
                              {product.featured && <Badge tone="brand">Destaque</Badge>}
                            </div>
                          </Td>
                          <Td className="whitespace-nowrap">
                            {product.compareAtPrice !== null && (
                              <span className="block text-2xs text-subtle line-through">
                                {formatBRL(product.compareAtPrice)}
                              </span>
                            )}
                            <span className="font-semibold text-accent">{formatBRL(product.price)}</span>
                          </Td>
                          <Td>
                            <div className="flex items-center justify-end gap-0.5">
                              {canReorder && (
                                <>
                                  <Tooltip label="Subir">
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`Subir ${product.name}`}
                                      disabled={index === 0 || reordering}
                                      onClick={() => moveProduct.mutate({ list: all, index, delta: -1 })}
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </Button>
                                  </Tooltip>
                                  <Tooltip label="Descer">
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`Descer ${product.name}`}
                                      disabled={index === all.length - 1 || reordering}
                                      onClick={() => moveProduct.mutate({ list: all, index, delta: 1 })}
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </Button>
                                  </Tooltip>
                                </>
                              )}
                              {canUpdateProduct && (
                                <Tooltip label={product.soldOut ? 'Marcar como disponível' : 'Marcar como esgotado'}>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={product.soldOut ? `Marcar ${product.name} como disponível` : `Marcar ${product.name} como esgotado`}
                                    aria-pressed={product.soldOut}
                                    className={product.soldOut ? 'text-warning' : undefined}
                                    onClick={() =>
                                      quickUpdate.mutate({
                                        product,
                                        patch: { soldOut: !product.soldOut },
                                        message: product.soldOut ? 'Produto disponível de novo.' : 'Produto marcado como esgotado.',
                                      })
                                    }
                                    disabled={quickUpdate.isPending}
                                  >
                                    <CircleSlash className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                              )}
                              {canUpdateProduct && (
                                <Tooltip label={product.featured ? 'Tirar dos destaques' : 'Colocar nos destaques'}>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={product.featured ? `Tirar ${product.name} dos destaques` : `Destacar ${product.name}`}
                                    aria-pressed={product.featured}
                                    className={product.featured ? 'text-accent' : undefined}
                                    onClick={() =>
                                      quickUpdate.mutate({
                                        product,
                                        patch: { featured: !product.featured },
                                        message: product.featured ? 'Produto fora dos destaques.' : 'Produto nos destaques.',
                                      })
                                    }
                                    disabled={quickUpdate.isPending}
                                  >
                                    <Star className="h-4 w-4" fill={product.featured ? 'currentColor' : 'none'} />
                                  </Button>
                                </Tooltip>
                              )}
                              {canUpdateProduct && (
                                <Tooltip label={product.active ? 'Pausar (some do cardápio)' : 'Mostrar no cardápio'}>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={product.active ? `Pausar ${product.name}` : `Mostrar ${product.name} no cardápio`}
                                    onClick={() =>
                                      quickUpdate.mutate({
                                        product,
                                        patch: { active: !product.active },
                                        message: product.active ? 'Produto pausado.' : 'Produto disponível.',
                                      })
                                    }
                                    disabled={quickUpdate.isPending}
                                  >
                                    {product.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                                  </Button>
                                </Tooltip>
                              )}
                              {canUpdateProduct && (
                                <Tooltip label="Editar">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Editar ${product.name}`}
                                    onClick={() => setProductDialog({ product, categoryId: product.categoryId })}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                              )}
                              {canCreateProduct && (
                                <Tooltip label="Duplicar">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Duplicar ${product.name}`}
                                    onClick={() => duplicateProduct.mutate(product)}
                                    disabled={duplicateProduct.isPending}
                                  >
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                              )}
                              {canDeleteProduct && (
                                <Tooltip label="Excluir">
                                  <Button
                                    variant="danger-ghost"
                                    size="icon-sm"
                                    aria-label={`Excluir ${product.name}`}
                                    onClick={() => setDeleteTarget({ kind: 'product', product })}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                              )}
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </TableWrap>
              )}
            </Card>
          );
        })
      )}

      {/* Category dialog */}
      <Dialog
        open={categoryDialog !== null}
        onClose={() => setCategoryDialog(null)}
        title={categoryDialog?.mode === 'edit' ? 'Editar categoria' : 'Nova categoria'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCategoryDialog(null)} disabled={saveCategory.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="category-form" loading={saveCategory.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="category-form" onSubmit={submitCategory} className="space-y-3">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Nome">
            <Input
              required
              autoFocus
              value={categoryForm.name}
              onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
            />
          </Field>
          <Field label="Descrição (opcional)">
            <Textarea
              value={categoryForm.description}
              onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
            />
          </Field>
          <Field label="Ordem de exibição">
            <Input
              type="number"
              min={0}
              value={categoryForm.displayOrder}
              onChange={(e) => setCategoryForm({ ...categoryForm, displayOrder: Number(e.target.value) })}
            />
          </Field>
        </form>
      </Dialog>

      {productDialog && (
        <ProductFormDialog
          open
          product={productDialog.product}
          categoryId={productDialog.categoryId}
          categories={categories}
          groups={groupsQuery.data ?? []}
          accessToken={accessToken as string}
          onClose={() => setProductDialog(null)}
          onSaved={async (_product, created, complete) => {
            await refresh();
            if (!complete) return;
            toast.success(created ? 'Produto criado.' : 'Produto atualizado.');
            setProductDialog(null);
          }}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={deleteTarget?.kind === 'category' ? 'Excluir categoria?' : 'Excluir produto?'}
        description={
          deleteTarget
            ? deleteTarget.kind === 'category'
              ? `A categoria "${deleteTarget.category.name}" será excluída.`
              : `O produto "${deleteTarget.product.name}" será excluído.`
            : undefined
        }
        confirmLabel="Excluir"
        danger
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  );
}
