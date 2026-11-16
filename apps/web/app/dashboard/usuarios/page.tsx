'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, UserCheck, UserX, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { listAccessibleBranches } from '@/lib/branches-api';
import { StaffUser, usersApi } from '@/lib/users-api';
import {
  branchesLabel,
  canManageTeam,
  canManageUser,
  lastLoginLabel,
  rolesLabel,
  STATUS_LABEL,
  STATUS_TONE,
  userErrorMessage,
} from '@/lib/users-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { ConfirmDialog } from '@/components/ds/Dialog';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import { ResetPasswordDialog } from '@/components/users/PasswordDialogs';
import { UserFormDialog } from '@/components/users/UserFormDialog';

// The API decides who may do what (users.read/create/update and the rules on who may change
// whom); these only hide controls the caller would be refused anyway. The manager sees the
// team but does not change it.
const CAN_READ = ['OWNER', 'ADMIN', 'MANAGER'];

type FormState = { user: StaffUser | null } | null;

export default function UsersPage() {
  const { user: me, accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = me?.roles ?? [];
  const canRead = roles.some((role) => CAN_READ.includes(role));
  const canManage = canManageTeam(roles);

  const [form, setForm] = useState<FormState>(null);
  const [resetFor, setResetFor] = useState<StaffUser | null>(null);
  const [toggleFor, setToggleFor] = useState<StaffUser | null>(null);

  const query = useQuery({
    queryKey: ['users', 'list'],
    queryFn: () => usersApi.list(accessToken as string),
    enabled: !!accessToken && canRead,
  });
  // Owner and administrator get every active branch here, which is what the form needs.
  const branches = useQuery({
    queryKey: ['branches', 'accessible'],
    queryFn: () => listAccessibleBranches(accessToken as string),
    enabled: !!accessToken && canRead,
  });

  const toggle = useMutation({
    mutationFn: (target: StaffUser) =>
      usersApi.update(accessToken as string, target.id, { active: target.status !== 'ACTIVE' }),
    onSuccess: async (saved) => {
      toast.success(saved.status === 'ACTIVE' ? `${saved.name} reativado.` : `${saved.name} inativado. As sessões foram encerradas.`);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      setToggleFor(null);
    },
    onError: (err) => {
      toast.error(userErrorMessage(err instanceof ApiError ? err.code : undefined, 'Não foi possível alterar a conta.'));
      setToggleFor(null);
    },
  });

  if (!canRead) {
    return (
      <Page>
        <EmptyState
          icon={<Users />}
          title="Sem acesso a Usuários"
          description="Somente proprietários, administradores e gerentes veem a equipe."
        />
      </Page>
    );
  }

  const rows = query.data ?? [];
  const branchList = branches.data ?? [];
  const actor = { id: me?.id ?? '', roles };

  return (
    <Page wide>
      <PageHeader
        title="Usuários"
        description="Quem entra no sistema, com qual papel e em quais unidades."
        actions={
          canManage ? (
            <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ user: null })}>
              Novo funcionário
            </Button>
          ) : undefined
        }
      />

      {query.isPending ? (
        <LoadingState label="Carregando usuários..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar os usuários." onRetry={() => void query.refetch()} />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[820px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Pessoa</Th>
                  <Th>Papel</Th>
                  <Th>Unidades</Th>
                  <Th>Situação</Th>
                  <Th>Último acesso</Th>
                  <Th className="relative">
                    <span className="sr-only">Ações</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((row) => {
                  const manageable = canManageUser(actor, row);
                  const active = row.status === 'ACTIVE';
                  return (
                    <Tr key={row.id}>
                      <Td>
                        <div className="font-semibold text-foreground">
                          {row.name}
                          {row.id === me?.id && <span className="ml-2 text-xs font-normal text-subtle">(você)</span>}
                        </div>
                        <div className="max-w-[18rem] truncate text-xs text-muted-foreground" title={row.email}>
                          {row.email}
                        </div>
                      </Td>
                      <Td>{rolesLabel(row)}</Td>
                      <Td className="text-muted-foreground">{branchesLabel(row, branchList)}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      </Td>
                      <Td className="text-xs tabular-nums text-muted-foreground">{lastLoginLabel(row.lastLoginAt)}</Td>
                      <Td>
                        {manageable && (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Pencil className="h-4 w-4" aria-hidden />}
                              onClick={() => setForm({ user: row })}
                            >
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<KeyRound className="h-4 w-4" aria-hidden />}
                              onClick={() => setResetFor(row)}
                            >
                              Senha
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={active ? <UserX className="h-4 w-4" aria-hidden /> : <UserCheck className="h-4 w-4" aria-hidden />}
                              onClick={() => setToggleFor(row)}
                            >
                              {active ? 'Inativar' : 'Reativar'}
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}

      <UserFormDialog open={form !== null} user={form?.user ?? null} branches={branchList} onClose={() => setForm(null)} />
      <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />
      <ConfirmDialog
        open={toggleFor !== null}
        title={toggleFor?.status === 'ACTIVE' ? 'Inativar funcionário' : 'Reativar funcionário'}
        description={
          toggleFor?.status === 'ACTIVE'
            ? `${toggleFor.name} não entra mais no sistema e as sessões abertas são encerradas. O histórico continua.`
            : `${toggleFor?.name} volta a entrar com a mesma senha.`
        }
        confirmLabel={toggleFor?.status === 'ACTIVE' ? 'Inativar' : 'Reativar'}
        danger={toggleFor?.status === 'ACTIVE'}
        loading={toggle.isPending}
        onConfirm={() => toggleFor && !toggle.isPending && toggle.mutate(toggleFor)}
        onClose={() => (toggle.isPending ? undefined : setToggleFor(null))}
      />
    </Page>
  );
}
