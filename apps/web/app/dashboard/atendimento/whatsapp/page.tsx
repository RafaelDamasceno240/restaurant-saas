'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { MessageCircle, MessagesSquare } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { hasPermission } from '@/lib/permissions';
import { ConversationStatus, whatsappApi } from '@/lib/whatsapp-api';
import { AUTHOR_LABEL, contactLabel, timeLabel } from '@/lib/whatsapp-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Tabs } from '@/components/ds/Tabs';
import { useToast } from '@/components/ds/Toast';
import { ConversationView } from '@/components/whatsapp/ConversationView';
import { SettingsPanel } from '@/components/whatsapp/SettingsPanel';
import { SimulatorPanel } from '@/components/whatsapp/SimulatorPanel';

type Section = 'conversas' | 'simulador' | 'configuracoes';
type Filter = 'all' | ConversationStatus;

// Atendimento > WhatsApp: the restaurant's conversations, the simulator and the assistant's
// settings. The API scopes everything to the restaurant of the session and checks each permission.
export default function WhatsappPage() {
  const { user, accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles ?? [];
  const canReply = hasPermission(roles, 'whatsapp.reply');
  const canConfigure = hasPermission(roles, 'whatsapp.configure');
  const [section, setSection] = useState<Section>('conversas');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['whatsapp', 'settings'],
    queryFn: () => whatsappApi.settings(accessToken!),
    enabled: !!accessToken,
    refetchInterval: 15_000,
  });
  const connected = !!settings.data?.connection;

  const conversations = useQuery({
    queryKey: ['whatsapp', 'conversations', filter],
    queryFn: () => whatsappApi.conversations(accessToken!, filter === 'all' ? undefined : filter),
    enabled: !!accessToken && connected && section === 'conversas',
    refetchInterval: 3000,
  });

  const create = useMutation({
    mutationFn: () => whatsappApi.createSimulatedConnection(accessToken!),
    onSuccess: (next) => {
      queryClient.setQueryData(['whatsapp', 'settings'], next);
      toast.success('Número simulado criado. Ative o assistente nas configurações.');
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar o número simulado.'),
  });

  const list = useMemo(() => conversations.data ?? [], [conversations.data]);
  // On a wide screen the first conversation opens by itself; on a phone the list comes first.
  useEffect(() => {
    if (!selected && list.length > 0 && window.matchMedia('(min-width: 1024px)').matches)
      setSelected(list[0].id);
  }, [list, selected]);

  // The tab counters (assistant / team) come with the settings: refresh them when a conversation
  // changes hands (e.g. the assistant handed one over while the list was open).
  const handsSignature = list.map((c) => `${c.id}:${c.status}`).join(',');
  useEffect(() => {
    if (handsSignature) void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'settings'] });
  }, [handsSignature, queryClient]);

  if (!accessToken || settings.isLoading)
    return <LoadingState label="Carregando o atendimento..." className="py-20" />;
  if (settings.isError)
    return (
      <ErrorState
        message={(settings.error as Error).message}
        onRetry={() => void settings.refetch()}
      />
    );

  const data = settings.data!;
  const sections = [
    {
      key: 'conversas' as const,
      label: 'Conversas',
      count: data.conversations.ai + data.conversations.human,
    },
    ...(canConfigure ? [{ key: 'simulador' as const, label: 'Simulador' }] : []),
    { key: 'configuracoes' as const, label: 'Configurações' },
  ];

  return (
    <Page wide>
      <PageHeader
        title="WhatsApp"
        description="Conversas com clientes, assistente de vendas e transferência para a equipe."
        actions={
          data.settings && (
            <Badge tone={data.settings.assistantEnabled ? 'success' : 'neutral'} dot>
              {data.settings.assistantEnabled ? 'Assistente ativado' : 'Assistente desativado'}
            </Badge>
          )
        }
      />

      {!connected ? (
        <Card>
          <EmptyState
            icon={<MessageCircle className="h-8 w-8" />}
            title="WhatsApp ainda não configurado"
            description={
              canConfigure
                ? 'Crie um número simulado para testar o assistente com o seu cardápio. Nenhum número real é conectado nesta versão.'
                : 'Peça ao dono do restaurante para configurar o WhatsApp.'
            }
            action={
              canConfigure && (
                <Button loading={create.isPending} onClick={() => create.mutate()}>
                  Criar número simulado
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Tabs items={sections} value={section} onChange={setSection} />

          {section === 'conversas' && (
            <Card className="grid h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden lg:grid-cols-[340px_minmax(0,1fr)]">
              <div
                className={clsx(
                  'flex min-h-0 min-w-0 flex-col border-line lg:border-r',
                  selected && 'hidden lg:flex',
                )}
              >
                <div className="border-b border-line p-3">
                  <Tabs
                    variant="pill"
                    value={filter}
                    onChange={(f) => {
                      setFilter(f);
                      setSelected(null);
                    }}
                    items={[
                      { key: 'all', label: 'Todas' },
                      { key: 'AI', label: 'Assistente', count: data.conversations.ai },
                      { key: 'HUMAN', label: 'Equipe', count: data.conversations.human },
                    ]}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {conversations.isLoading ? (
                    <LoadingState className="py-10" />
                  ) : list.length === 0 ? (
                    <EmptyState
                      icon={<MessagesSquare className="h-6 w-6" />}
                      title="Nenhuma conversa"
                      description={
                        canConfigure
                          ? 'Use o Simulador para testar uma conversa.'
                          : 'As conversas aparecem aqui quando os clientes escreverem.'
                      }
                    />
                  ) : (
                    <ul aria-label="Conversas">
                      {list.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(c.id)}
                            aria-current={selected === c.id ? 'true' : undefined}
                            className={clsx(
                              'flex w-full flex-col gap-1 border-b border-line px-4 py-3 text-left hover:bg-surface-hover focus-visible:bg-surface-hover',
                              selected === c.id && 'bg-primary/10',
                            )}
                          >
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate font-semibold">
                                {contactLabel(c.contact)}
                              </span>
                              {c.lastMessage && (
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                  {timeLabel(c.lastMessage.at)}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                                {c.lastMessage
                                  ? `${c.lastMessage.author === 'CUSTOMER' ? '' : `${AUTHOR_LABEL[c.lastMessage.author]}: `}${c.lastMessage.body}`
                                  : ''}
                              </span>
                              <Badge tone={c.status === 'AI' ? 'info' : 'warning'}>
                                {c.status === 'AI' ? 'IA' : 'Equipe'}
                              </Badge>
                              {c.unreadCount > 0 && (
                                <span
                                  className="flex h-5 min-w-5 items-center justify-center rounded-full bg-success px-1.5 text-[11px] font-bold text-white"
                                  aria-label={`${c.unreadCount} não lidas`}
                                >
                                  {c.unreadCount}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className={clsx('min-h-0 min-w-0', !selected && 'hidden lg:block')}>
                {selected ? (
                  <div className="flex h-full min-h-0 flex-col">
                    <button
                      type="button"
                      className="px-4 pt-3 text-left text-sm font-semibold text-primary lg:hidden"
                      onClick={() => setSelected(null)}
                    >
                      ← Conversas
                    </button>
                    <div className="min-h-0 flex-1">
                      <ConversationView
                        key={selected}
                        token={accessToken}
                        conversationId={selected}
                        canReply={canReply}
                      />
                    </div>
                  </div>
                ) : (
                  <EmptyState
                    icon={<MessageCircle className="h-6 w-6" />}
                    title="Escolha uma conversa"
                    className="h-full"
                  />
                )}
              </div>
            </Card>
          )}

          {section === 'simulador' && canConfigure && <SimulatorPanel token={accessToken} />}
          {section === 'configuracoes' && data.settings && (
            <SettingsPanel token={accessToken} data={data} canConfigure={canConfigure} />
          )}
        </div>
      )}
    </Page>
  );
}
