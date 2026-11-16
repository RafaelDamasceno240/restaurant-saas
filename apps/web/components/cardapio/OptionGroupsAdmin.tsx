'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CircleSlash,
  Layers,
  Link2,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { ApiError, useAuth } from '@/lib/auth-context';
import {
  categoriesApi,
  OptionGroup,
  OptionItem,
  optionGroupsApi,
  productsApi,
} from '@/lib/cardapio-api';
import { formatBRL } from '@/lib/format';
import {
  groupRangeProblem,
  groupRuleLabel,
  MAX_SELECT_LIMIT,
  moveItem,
  optionPriceProblem,
  parseMoney,
} from '@/lib/menu-admin-logic';
import { hasPermission } from '@/lib/permissions';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { ConfirmDialog, Dialog } from '@/components/ds/Dialog';
import { Field, Input, SearchInput, Textarea } from '@/components/ds/Input';
import { Switch } from '@/components/ds/Switch';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tooltip } from '@/components/ds/Tooltip';
import { useToast } from '@/components/ds/Toast';
import { MENU_ADMIN_KEY } from './MenuAdmin';

const messageOf = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

type GroupForm = {
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  active: boolean;
};
type OptionForm = {
  name: string;
  description: string;
  price: string;
  maxQuantity: number;
  active: boolean;
  soldOut: boolean;
};
type GroupDialog = { group: OptionGroup | null } | null;
type OptionDialog = { group: OptionGroup; option: OptionItem | null } | null;
type DeleteTarget =
  | { kind: 'group'; group: OptionGroup }
  | { kind: 'option'; group: OptionGroup; option: OptionItem }
  | null;

const priceText = (value: number) => value.toFixed(2).replace('.', ',');

// Add-on groups ("Turbine seu lanche!", "Escolha o refrigerante") and their options. A group is
// shared: every product that offers it sees the same options and prices. Prices and limits are
// checked again by the API on every order; orders already taken keep what was sold.
export function OptionGroupsAdmin() {
  const { accessToken, user } = useAuth();
  const roles = user?.roles;
  const canCreate = hasPermission(roles, 'products.create');
  const canUpdate = hasPermission(roles, 'products.update');
  const canDelete = hasPermission(roles, 'products.delete');
  const token = accessToken as string;
  const queryClient = useQueryClient();
  const toast = useToast();

  const groupsQuery = useQuery({
    queryKey: [...MENU_ADMIN_KEY, 'option-groups'],
    queryFn: () => optionGroupsApi.list(token),
    enabled: !!accessToken,
  });
  const productsQuery = useQuery({
    queryKey: [...MENU_ADMIN_KEY, 'products'],
    queryFn: () => productsApi.list(token),
    enabled: !!accessToken,
  });
  const categoriesQuery = useQuery({
    queryKey: [...MENU_ADMIN_KEY, 'categories'],
    queryFn: () => categoriesApi.list(token),
    enabled: !!accessToken,
  });

  const [search, setSearch] = useState('');
  const [groupDialog, setGroupDialog] = useState<GroupDialog>(null);
  const [groupForm, setGroupForm] = useState<GroupForm>({
    name: '',
    required: false,
    minSelect: 0,
    maxSelect: 1,
    active: true,
  });
  const [optionDialog, setOptionDialog] = useState<OptionDialog>(null);
  const [optionForm, setOptionForm] = useState<OptionForm>({
    name: '',
    description: '',
    price: '0',
    maxQuantity: 1,
    active: true,
    soldOut: false,
  });
  const [linkDialog, setLinkDialog] = useState<OptionGroup | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [productSearch, setProductSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: MENU_ADMIN_KEY });
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const term = search.trim().toLowerCase();
  const shownGroups = term
    ? groups.filter(
        (g) =>
          g.name.toLowerCase().includes(term) ||
          g.options.some((o) => o.name.toLowerCase().includes(term)),
      )
    : groups;
  const productName = useMemo(
    () => new Map((productsQuery.data ?? []).map((p) => [p.id, p.name])),
    [productsQuery.data],
  );

  // ---- groups -----------------------------------------------------------------------------

  function openGroup(group: OptionGroup | null) {
    setFormError(null);
    setGroupForm(
      group
        ? {
            name: group.name,
            required: group.minSelect > 0,
            minSelect: group.minSelect,
            maxSelect: group.maxSelect,
            active: group.active,
          }
        : { name: '', required: false, minSelect: 0, maxSelect: 1, active: true },
    );
    setGroupDialog({ group });
  }

  const saveGroup = useMutation({
    mutationFn: () => {
      const input = {
        name: groupForm.name.trim(),
        minSelect: groupForm.required ? groupForm.minSelect : 0,
        maxSelect: groupForm.maxSelect,
        active: groupForm.active,
      };
      return groupDialog?.group
        ? optionGroupsApi.update(token, groupDialog.group.id, input)
        : optionGroupsApi.create(token, input);
    },
    onSuccess: async () => {
      toast.success(
        groupDialog?.group ? 'Grupo atualizado.' : 'Grupo criado. Agora cadastre as opções.',
      );
      setGroupDialog(null);
      await refresh();
    },
    onError: (err) => setFormError(messageOf(err, 'Não foi possível salvar o grupo.')),
  });

  function submitGroup(event: FormEvent) {
    event.preventDefault();
    const min = groupForm.required ? groupForm.minSelect : 0;
    const problem =
      groupForm.required && min < 1
        ? 'Um grupo obrigatório pede pelo menos 1 escolha.'
        : groupRangeProblem(min, groupForm.maxSelect);
    setFormError(problem);
    if (!problem) saveGroup.mutate();
  }

  const toggleGroup = useMutation({
    mutationFn: (group: OptionGroup) =>
      optionGroupsApi.update(token, group.id, { active: !group.active }),
    onSuccess: async (_r, group) => {
      toast.success(group.active ? 'Grupo pausado: some de todos os produtos.' : 'Grupo ativado.');
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível atualizar o grupo.')),
  });

  // ---- options ----------------------------------------------------------------------------

  function openOption(group: OptionGroup, option: OptionItem | null) {
    setFormError(null);
    setOptionForm(
      option
        ? {
            name: option.name,
            description: option.description ?? '',
            price: priceText(option.price),
            maxQuantity: option.maxQuantity,
            active: option.active,
            soldOut: option.soldOut,
          }
        : { name: '', description: '', price: '0', maxQuantity: 1, active: true, soldOut: false },
    );
    setOptionDialog({ group, option });
  }

  const saveOption = useMutation({
    mutationFn: () => {
      const input = {
        name: optionForm.name.trim(),
        description: optionForm.description.trim() || null,
        price: parseMoney(optionForm.price) ?? 0,
        maxQuantity: optionForm.maxQuantity,
        active: optionForm.active,
        soldOut: optionForm.soldOut,
      };
      const d = optionDialog!;
      return d.option
        ? optionGroupsApi.updateOption(token, d.group.id, d.option.id, input)
        : optionGroupsApi.addOption(token, d.group.id, input);
    },
    onSuccess: async () => {
      toast.success(optionDialog?.option ? 'Adicional atualizado.' : 'Adicional cadastrado.');
      setOptionDialog(null);
      await refresh();
    },
    onError: (err) => setFormError(messageOf(err, 'Não foi possível salvar o adicional.')),
  });

  function submitOption(event: FormEvent) {
    event.preventDefault();
    const problem =
      optionPriceProblem(optionForm.price) ??
      (optionForm.maxQuantity < 1 || optionForm.maxQuantity > MAX_SELECT_LIMIT
        ? `A quantidade máxima deve ficar entre 1 e ${MAX_SELECT_LIMIT}.`
        : null);
    setFormError(problem);
    if (!problem) saveOption.mutate();
  }

  const quickOption = useMutation({
    mutationFn: ({
      group,
      option,
      patch,
    }: {
      group: OptionGroup;
      option: OptionItem;
      patch: Partial<OptionItem>;
      message: string;
    }) => optionGroupsApi.updateOption(token, group.id, option.id, patch),
    onSuccess: async (_r, { message }) => {
      toast.success(message);
      await refresh();
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível atualizar o adicional.')),
  });

  const moveOption = useMutation({
    mutationFn: ({ group, index, delta }: { group: OptionGroup; index: number; delta: -1 | 1 }) =>
      optionGroupsApi.reorderOptions(
        token,
        group.id,
        moveItem(group.options, index, delta).map((o) => o.id),
      ),
    onSuccess: () => refresh(),
    onError: async (err) => {
      toast.error(messageOf(err, 'Não foi possível mudar a ordem.'));
      await refresh();
    },
  });

  // ---- products of a group ----------------------------------------------------------------

  function openLinks(group: OptionGroup) {
    setProductSearch('');
    setFormError(null);
    setLinked(new Set(group.productIds));
    setLinkDialog(group);
  }

  const saveLinks = useMutation({
    mutationFn: () => optionGroupsApi.setProducts(token, linkDialog!.id, [...linked]),
    onSuccess: async () => {
      toast.success('Produtos do grupo atualizados.');
      setLinkDialog(null);
      await refresh();
    },
    onError: (err) => setFormError(messageOf(err, 'Não foi possível salvar os produtos do grupo.')),
  });

  const productsByCategory = useMemo(() => {
    const productTerm = productSearch.trim().toLowerCase();
    const categories = [...(categoriesQuery.data ?? [])].sort(
      (a, b) => a.displayOrder - b.displayOrder,
    );
    return categories
      .map((c) => ({
        category: c,
        products: (productsQuery.data ?? [])
          .filter(
            (p) =>
              p.categoryId === c.id && (!productTerm || p.name.toLowerCase().includes(productTerm)),
          )
          .sort((a, b) => a.displayOrder - b.displayOrder),
      }))
      .filter((s) => s.products.length > 0);
  }, [categoriesQuery.data, productsQuery.data, productSearch]);

  // ---- delete -----------------------------------------------------------------------------

  const remove = useMutation({
    mutationFn: async (target: NonNullable<DeleteTarget>): Promise<void> => {
      if (target.kind === 'group') await optionGroupsApi.remove(token, target.group.id);
      else await optionGroupsApi.removeOption(token, target.group.id, target.option.id);
    },
    onSuccess: async (_r, target) => {
      toast.success(target.kind === 'group' ? 'Grupo excluído.' : 'Adicional removido.');
      setDeleteTarget(null);
      await refresh();
    },
    onError: (err) => {
      setDeleteTarget(null);
      toast.error(messageOf(err, 'Não foi possível excluir.'));
    },
  });

  // ---- render -----------------------------------------------------------------------------

  if (groupsQuery.isLoading) return <LoadingState label="Carregando adicionais..." />;
  if (groupsQuery.isError)
    return (
      <ErrorState
        message="Não foi possível carregar os adicionais."
        onRetry={() => groupsQuery.refetch()}
      />
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <SearchInput
            placeholder="Buscar grupo ou adicional..."
            aria-label="Buscar grupo ou adicional"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {canCreate && (
          <Button
            className="ml-auto"
            icon={<Plus className="h-4 w-4" />}
            onClick={() => openGroup(null)}
          >
            Novo grupo de adicionais
          </Button>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="Nenhum grupo de adicionais"
          description={
            canCreate
              ? 'Crie um grupo (ex.: "Turbine seu lanche!" ou "Escolha o refrigerante"), cadastre as opções e escolha os produtos que oferecem o grupo.'
              : 'O responsável pelo restaurante ainda não cadastrou adicionais.'
          }
          action={
            canCreate ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => openGroup(null)}>
                Novo grupo de adicionais
              </Button>
            ) : undefined
          }
        />
      ) : shownGroups.length === 0 ? (
        <EmptyState icon={<Layers />} title="Nada encontrado" description="Ajuste a busca." />
      ) : (
        shownGroups.map((group) => (
          <Card key={group.id} className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">{group.name}</h2>
                  <Badge tone={group.required ? 'warning' : 'neutral'}>
                    {group.required ? 'Obrigatório' : 'Opcional'}
                  </Badge>
                  {!group.active && (
                    <Badge tone="neutral" dot>
                      Pausado
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-subtle">
                  {groupRuleLabel(group.minSelect, group.maxSelect)} · usado em{' '}
                  {group.productIds.length} produto
                  {group.productIds.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {canUpdate && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<Link2 className="h-3.5 w-3.5" />}
                    onClick={() => openLinks(group)}
                  >
                    Produtos ({group.productIds.length})
                  </Button>
                )}
                {canUpdate && (
                  <Tooltip label={group.active ? 'Pausar grupo' : 'Ativar grupo'}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        group.active ? `Pausar grupo ${group.name}` : `Ativar grupo ${group.name}`
                      }
                      onClick={() => toggleGroup.mutate(group)}
                      disabled={toggleGroup.isPending}
                    >
                      {group.active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                  </Tooltip>
                )}
                {canUpdate && (
                  <Tooltip label="Editar grupo">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Editar grupo ${group.name}`}
                      onClick={() => openGroup(group)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                )}
                {canDelete && (
                  <Tooltip label="Excluir grupo">
                    <Button
                      variant="danger-ghost"
                      size="icon-sm"
                      aria-label={`Excluir grupo ${group.name}`}
                      onClick={() => setDeleteTarget({ kind: 'group', group })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                )}
                {canUpdate && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-1"
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={() => openOption(group, null)}
                  >
                    Novo adicional
                  </Button>
                )}
              </div>
            </div>

            {group.warnings.map((w) => (
              <p
                key={w}
                role="status"
                className="flex gap-2 border-b border-line bg-warning/10 px-4 py-2 text-xs text-warning"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {w}
              </p>
            ))}

            {group.options.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhuma opção neste grupo ainda.
              </p>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <Th>Adicional</Th>
                      <Th className="w-32">Status</Th>
                      <Th className="w-28">Preço</Th>
                      <Th className="w-28">Máx. por produto</Th>
                      <Th className="w-60 text-right">Ações</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {group.options.map((option, index) => (
                      <Tr key={option.id}>
                        <Td>
                          <p className="font-medium text-foreground">{option.name}</p>
                          {option.description && (
                            <p className="max-w-xs truncate text-xs text-subtle">
                              {option.description}
                            </p>
                          )}
                        </Td>
                        <Td>
                          {!option.active ? (
                            <Badge tone="neutral" dot>
                              Inativo
                            </Badge>
                          ) : option.soldOut ? (
                            <Badge tone="warning" dot>
                              Esgotado
                            </Badge>
                          ) : (
                            <Badge tone="success" dot>
                              Disponível
                            </Badge>
                          )}
                        </Td>
                        <Td className="whitespace-nowrap font-semibold text-accent">
                          {option.price === 0 ? 'Grátis' : `+ ${formatBRL(option.price)}`}
                        </Td>
                        <Td>{option.maxQuantity}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-0.5">
                            {canUpdate && !term && (
                              <>
                                <Tooltip label="Subir">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Subir ${option.name}`}
                                    disabled={index === 0 || moveOption.isPending}
                                    onClick={() => moveOption.mutate({ group, index, delta: -1 })}
                                  >
                                    <ArrowUp className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                                <Tooltip label="Descer">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={`Descer ${option.name}`}
                                    disabled={
                                      index === group.options.length - 1 || moveOption.isPending
                                    }
                                    onClick={() => moveOption.mutate({ group, index, delta: 1 })}
                                  >
                                    <ArrowDown className="h-4 w-4" />
                                  </Button>
                                </Tooltip>
                              </>
                            )}
                            {canUpdate && (
                              <Tooltip
                                label={
                                  option.soldOut ? 'Marcar como disponível' : 'Marcar como esgotado'
                                }
                              >
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={
                                    option.soldOut
                                      ? `Marcar ${option.name} como disponível`
                                      : `Marcar ${option.name} como esgotado`
                                  }
                                  aria-pressed={option.soldOut}
                                  className={option.soldOut ? 'text-warning' : undefined}
                                  onClick={() =>
                                    quickOption.mutate({
                                      group,
                                      option,
                                      patch: { soldOut: !option.soldOut },
                                      message: option.soldOut
                                        ? 'Adicional disponível de novo.'
                                        : 'Adicional esgotado.',
                                    })
                                  }
                                  disabled={quickOption.isPending}
                                >
                                  <CircleSlash className="h-4 w-4" />
                                </Button>
                              </Tooltip>
                            )}
                            {canUpdate && (
                              <Tooltip label="Editar">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Editar ${option.name}`}
                                  onClick={() => openOption(group, option)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </Tooltip>
                            )}
                            {canUpdate && (
                              // No Tooltip here: centered over the last button of the row, it would
                              // stick out of the card and give the table a sideways scroll.
                              <Button
                                variant="danger-ghost"
                                size="icon-sm"
                                title="Remover"
                                aria-label={`Remover ${option.name}`}
                                onClick={() => setDeleteTarget({ kind: 'option', group, option })}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
        ))
      )}

      {/* Group dialog */}
      <Dialog
        open={groupDialog !== null}
        onClose={() => setGroupDialog(null)}
        title={groupDialog?.group ? 'Editar grupo de adicionais' : 'Novo grupo de adicionais'}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setGroupDialog(null)}
              disabled={saveGroup.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" form="group-form" loading={saveGroup.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="group-form" onSubmit={submitGroup} className="space-y-3">
          {formError && <Alert>{formError}</Alert>}
          {groupDialog?.group && groupDialog.group.productIds.length > 1 && (
            <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
              Este grupo é usado em {groupDialog.group.productIds.length} produtos: a mudança vale
              para todos eles.
            </p>
          )}
          <Field label="Nome do grupo" hint='O cliente vê este nome, ex.: "Turbine seu lanche!"'>
            <Input
              required
              autoFocus
              maxLength={80}
              value={groupForm.name}
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
            />
          </Field>
          <div className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
            <span>
              <span className="block text-sm font-medium text-foreground">Obrigatório</span>
              <span className="block text-2xs text-subtle">
                O cliente precisa escolher antes de adicionar o produto.
              </span>
            </span>
            <Switch
              label="Obrigatório"
              checked={groupForm.required}
              onChange={(v) =>
                setGroupForm({
                  ...groupForm,
                  required: v,
                  minSelect: v ? Math.max(1, groupForm.minSelect) : 0,
                })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Mínimo de escolhas"
              hint={groupForm.required ? 'Pelo menos 1.' : 'Opcional: 0.'}
            >
              <Input
                type="number"
                min={groupForm.required ? 1 : 0}
                max={MAX_SELECT_LIMIT}
                disabled={!groupForm.required}
                value={groupForm.required ? groupForm.minSelect : 0}
                onChange={(e) => setGroupForm({ ...groupForm, minSelect: Number(e.target.value) })}
              />
            </Field>
            <Field label="Máximo de escolhas" hint="Somando todas as opções do grupo.">
              <Input
                type="number"
                min={1}
                max={MAX_SELECT_LIMIT}
                value={groupForm.maxSelect}
                onChange={(e) => setGroupForm({ ...groupForm, maxSelect: Number(e.target.value) })}
              />
            </Field>
          </div>
          <p className="text-xs text-subtle">
            O cliente verá:{' '}
            <strong>
              {groupRuleLabel(groupForm.required ? groupForm.minSelect : 0, groupForm.maxSelect)}
            </strong>
          </p>
        </form>
      </Dialog>

      {/* Option dialog */}
      <Dialog
        open={optionDialog !== null}
        onClose={() => setOptionDialog(null)}
        title={
          optionDialog?.option
            ? 'Editar adicional'
            : `Novo adicional em "${optionDialog?.group.name ?? ''}"`
        }
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setOptionDialog(null)}
              disabled={saveOption.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" form="option-form" loading={saveOption.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <form id="option-form" onSubmit={submitOption} className="space-y-3">
          {formError && <Alert>{formError}</Alert>}
          {optionDialog?.option && (
            <p className="text-xs text-subtle">
              Pedidos já feitos mantêm o nome e o preço da época.
            </p>
          )}
          <Field label="Nome">
            <Input
              required
              autoFocus
              maxLength={80}
              value={optionForm.name}
              onChange={(e) => setOptionForm({ ...optionForm, name: e.target.value })}
            />
          </Field>
          <Field label="Descrição (opcional)">
            <Textarea
              maxLength={300}
              value={optionForm.description}
              onChange={(e) => setOptionForm({ ...optionForm, description: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Preço (R$)" hint="0 = grátis">
              <Input
                inputMode="decimal"
                required
                value={optionForm.price}
                onChange={(e) => setOptionForm({ ...optionForm, price: e.target.value })}
              />
            </Field>
            <Field label="Máximo por produto" hint="Quantas unidades deste adicional.">
              <Input
                type="number"
                min={1}
                max={MAX_SELECT_LIMIT}
                value={optionForm.maxQuantity}
                onChange={(e) =>
                  setOptionForm({ ...optionForm, maxQuantity: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <div className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-2">
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-foreground">Esgotado</span>
                <span className="block text-2xs text-subtle">Some do cardápio até voltar.</span>
              </span>
              <Switch
                label="Esgotado"
                checked={optionForm.soldOut}
                onChange={(v) => setOptionForm({ ...optionForm, soldOut: v })}
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <span>
                <span className="block text-sm font-medium text-foreground">Ativo</span>
                <span className="block text-2xs text-subtle">Desligado: não é mais oferecido.</span>
              </span>
              <Switch
                label="Ativo"
                checked={optionForm.active}
                onChange={(v) => setOptionForm({ ...optionForm, active: v })}
              />
            </div>
          </div>
        </form>
      </Dialog>

      {/* Products of a group */}
      <Dialog
        open={linkDialog !== null}
        onClose={() => setLinkDialog(null)}
        size="lg"
        title={`Produtos com "${linkDialog?.name ?? ''}"`}
        footer={
          <>
            <span className="mr-auto text-xs text-subtle">{linked.size} selecionado(s)</span>
            <Button
              variant="ghost"
              onClick={() => setLinkDialog(null)}
              disabled={saveLinks.isPending}
            >
              Cancelar
            </Button>
            <Button onClick={() => saveLinks.mutate()} loading={saveLinks.isPending}>
              Salvar
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {formError && <Alert>{formError}</Alert>}
          <SearchInput
            placeholder="Buscar produto..."
            aria-label="Buscar produto para o grupo"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />
          {productsByCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          ) : (
            productsByCategory.map(({ category, products }) => {
              const all = products.every((p) => linked.has(p.id));
              return (
                <fieldset key={category.id} className="rounded-lg border border-line">
                  <legend className="sr-only">{category.name}</legend>
                  <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                    <span className="text-xs font-semibold text-foreground">{category.name}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLinked((prev) => {
                          const next = new Set(prev);
                          for (const p of products) {
                            if (all) next.delete(p.id);
                            else next.add(p.id);
                          }
                          return next;
                        })
                      }
                    >
                      {all ? 'Desmarcar todos' : 'Marcar todos'}
                    </Button>
                  </div>
                  <ul className="divide-y divide-line">
                    {products.map((p) => (
                      <li key={p.id}>
                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm touch:py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[rgb(var(--accent))]"
                            checked={linked.has(p.id)}
                            onChange={(e) =>
                              setLinked((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(p.id);
                                else next.delete(p.id);
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {!p.active && <Badge tone="neutral">Pausado</Badge>}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={
          deleteTarget?.kind === 'group' ? 'Excluir grupo de adicionais?' : 'Remover adicional?'
        }
        description={
          deleteTarget
            ? deleteTarget.kind === 'group'
              ? `O grupo "${deleteTarget.group.name}" e suas ${deleteTarget.group.options.length} opções saem de ${deleteTarget.group.productIds.length} produto(s)${
                  deleteTarget.group.productIds.length
                    ? ` (${deleteTarget.group.productIds
                        .slice(0, 3)
                        .map((id) => productName.get(id) ?? '?')
                        .join(', ')}${deleteTarget.group.productIds.length > 3 ? '…' : ''})`
                    : ''
                }. Pedidos já feitos não mudam.`
              : `"${deleteTarget.option.name}" sai do grupo "${deleteTarget.group.name}". Pedidos já feitos não mudam. Para tirar só por um tempo, use "Esgotado".`
            : undefined
        }
        confirmLabel={deleteTarget?.kind === 'group' ? 'Excluir' : 'Remover'}
        danger
        loading={remove.isPending}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
      />
    </div>
  );
}
