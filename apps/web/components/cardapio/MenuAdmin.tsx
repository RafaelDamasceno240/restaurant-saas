'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Copy, ImageIcon, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useAuth, ApiError } from '@/lib/auth-context';
import { categoriesApi, Category, productsApi, Product } from '@/lib/cardapio-api';
import { formatBRL } from '@/lib/format';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { ConfirmDialog, Dialog } from '@/components/ds/Dialog';
import { Field, Input, SearchInput, Select, Textarea } from '@/components/ds/Input';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tooltip } from '@/components/ds/Tooltip';
import { useToast } from '@/components/ds/Toast';

const emptyCategoryForm = { name: '', description: '', displayOrder: 0 };
const emptyProductForm = { categoryId: '', name: '', description: '', price: '', imageUrl: '', displayOrder: 0 };

type CategoryDialog = { mode: 'create' } | { mode: 'edit'; category: Category } | null;
type ProductDialog = { mode: 'create'; categoryId: string } | { mode: 'edit'; product: Product } | null;
type DeleteTarget = { kind: 'category'; category: Category } | { kind: 'product'; product: Product } | null;

function messageOf(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

// Presentation of the cardápio admin: one section per category with a dense
// product table. Every write goes through the same categoriesApi/productsApi
// calls the previous panels used — only the layout and interaction changed
// (dialogs instead of inline forms / window.confirm).
export function MenuAdmin({ onCategoryCount }: { onCategoryCount?: (n: number) => void }) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog>(null);
  const [productDialog, setProductDialog] = useState<ProductDialog>(null);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [productForm, setProductForm] = useState(emptyProductForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const categoriesQuery = useQuery({
    queryKey: ['menu-admin', 'categories'],
    queryFn: async () => {
      const list = await categoriesApi.list(accessToken as string);
      onCategoryCount?.(list.length);
      return list;
    },
    enabled: !!accessToken,
  });
  const productsQuery = useQuery({
    queryKey: ['menu-admin', 'products'],
    queryFn: () => productsApi.list(accessToken as string),
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
    return queryClient.invalidateQueries({ queryKey: ['menu-admin'] });
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

  const saveProduct = useMutation({
    mutationFn: async () => {
      const input = {
        categoryId: productForm.categoryId,
        name: productForm.name,
        description: productForm.description || undefined,
        price: Number(productForm.price),
        imageUrl: productForm.imageUrl || undefined,
        displayOrder: Number(productForm.displayOrder) || 0,
      };
      if (productDialog?.mode === 'edit') {
        return productsApi.update(accessToken as string, productDialog.product.id, input);
      }
      return productsApi.create(accessToken as string, input);
    },
    onSuccess: async () => {
      toast.success(productDialog?.mode === 'edit' ? 'Produto atualizado.' : 'Produto criado.');
      setProductDialog(null);
      await refresh();
    },
    onError: (err) => setFormError(messageOf(err, 'Não foi possível salvar o produto.')),
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

  const toggleProduct = useMutation({
    mutationFn: (product: Product) =>
      productsApi.update(accessToken as string, product.id, { active: !product.active }),
    onSuccess: async (_r, product) => {
      toast.success(product.active ? 'Produto pausado.' : 'Produto disponível.');
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível atualizar o produto.')),
  });

  const duplicateProduct = useMutation({
    mutationFn: (product: Product) =>
      productsApi.create(accessToken as string, {
        categoryId: product.categoryId,
        name: `${product.name} (cópia)`,
        description: product.description ?? undefined,
        price: product.price,
        imageUrl: product.imageUrl ?? undefined,
        displayOrder: product.displayOrder,
      }),
    onSuccess: async () => {
      toast.success('Produto duplicado.');
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

  function openCreateProduct(categoryId: string) {
    setFormError(null);
    setProductForm({ ...emptyProductForm, categoryId });
    setProductDialog({ mode: 'create', categoryId });
  }

  function openEditProduct(product: Product) {
    setFormError(null);
    setProductForm({
      categoryId: product.categoryId,
      name: product.name,
      description: product.description ?? '',
      price: String(product.price),
      imageUrl: product.imageUrl ?? '',
      displayOrder: product.displayOrder,
    });
    setProductDialog({ mode: 'edit', product });
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    saveCategory.mutate();
  }

  function submitProduct(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    saveProduct.mutate();
  }

  // ---- render -------------------------------------------------------------

  const isLoading = categoriesQuery.isLoading || productsQuery.isLoading;
  const isError = categoriesQuery.isError || productsQuery.isError;

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
        <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={openCreateCategory}>
          Nova categoria
        </Button>
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
          description="Comece criando uma categoria (ex.: Burgers, Bebidas) e depois adicione os produtos."
          action={
            <Button icon={<Plus className="h-4 w-4" />} onClick={openCreateCategory}>
              Nova categoria
            </Button>
          }
        />
      ) : sections.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="Nenhum produto encontrado" description="Ajuste a busca ou o filtro." />
      ) : (
        sections.map(({ category, all, shown }) => (
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
              <div className="flex items-center gap-1">
                <Tooltip label={category.active ? 'Pausar categoria' : 'Ativar categoria'}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={category.active ? 'Pausar categoria' : 'Ativar categoria'}
                    onClick={() => toggleCategory.mutate(category)}
                    disabled={toggleCategory.isPending}
                  >
                    {category.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </Tooltip>
                <Tooltip label="Editar categoria">
                  <Button variant="ghost" size="icon-sm" aria-label="Editar categoria" onClick={() => openEditCategory(category)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </Tooltip>
                <Tooltip label="Excluir categoria">
                  <Button
                    variant="danger-ghost"
                    size="icon-sm"
                    aria-label="Excluir categoria"
                    onClick={() => setDeleteTarget({ kind: 'category', category })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </Tooltip>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => openCreateProduct(category.id)}
                >
                  Adicionar produto
                </Button>
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
                      <Th className="w-40">Status</Th>
                      <Th className="w-32">Preço</Th>
                      <Th className="w-44 text-right">Ações</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {shown.map((product) => (
                      <Tr key={product.id}>
                        <Td>
                          <div className="flex items-center gap-3">
                            {product.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={product.imageUrl}
                                alt=""
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
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <Badge tone={product.active ? 'success' : 'neutral'} dot>
                            {product.active ? 'Disponível' : 'Pausado'}
                          </Badge>
                        </Td>
                        <Td className="whitespace-nowrap font-semibold text-accent">{formatBRL(product.price)}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-0.5">
                            <Tooltip label={product.active ? 'Pausar' : 'Disponibilizar'}>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={product.active ? 'Pausar produto' : 'Disponibilizar produto'}
                                onClick={() => toggleProduct.mutate(product)}
                                disabled={toggleProduct.isPending}
                              >
                                {product.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                              </Button>
                            </Tooltip>
                            <Tooltip label="Editar">
                              <Button variant="ghost" size="icon-sm" aria-label="Editar produto" onClick={() => openEditProduct(product)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip label="Duplicar">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Duplicar produto"
                                onClick={() => duplicateProduct.mutate(product)}
                                disabled={duplicateProduct.isPending}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                            <Tooltip label="Excluir">
                              <Button
                                variant="danger-ghost"
                                size="icon-sm"
                                aria-label="Excluir produto"
                                onClick={() => setDeleteTarget({ kind: 'product', product })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </Tooltip>
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Card>
        ))
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

      {/* Product dialog */}
      <Dialog
        open={productDialog !== null}
        onClose={() => setProductDialog(null)}
        title={productDialog?.mode === 'edit' ? 'Editar produto' : 'Novo produto'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setProductDialog(null)} disabled={saveProduct.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="product-form" loading={saveProduct.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="product-form" onSubmit={submitProduct} className="space-y-3">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Categoria">
            <Select
              required
              value={productForm.categoryId}
              onChange={(e) => setProductForm({ ...productForm, categoryId: e.target.value })}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Nome">
            <Input
              required
              autoFocus
              value={productForm.name}
              onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
            />
          </Field>
          <Field label="Descrição (opcional)">
            <Textarea
              value={productForm.description}
              onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço (R$)">
              <Input
                type="number"
                step="0.01"
                min={0}
                required
                value={productForm.price}
                onChange={(e) => setProductForm({ ...productForm, price: e.target.value })}
              />
            </Field>
            <Field label="Ordem de exibição">
              <Input
                type="number"
                min={0}
                value={productForm.displayOrder}
                onChange={(e) => setProductForm({ ...productForm, displayOrder: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="URL da imagem (opcional)">
            <Input
              value={productForm.imageUrl}
              onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })}
            />
          </Field>
        </form>
      </Dialog>

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
