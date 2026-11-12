'use client';

import { FormEvent, KeyboardEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Headset, Send, ShoppingCart } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { whatsappApi } from '@/lib/whatsapp-api';
import {
  MESSAGE_MAX,
  STATUS_LABEL,
  contactLabel,
  formatWaId,
  replyBlock,
  validateReply,
} from '@/lib/whatsapp-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Textarea } from '@/components/ds/Input';
import { Alert, ErrorState, LoadingState } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';
import { ChatThread } from './ChatThread';

const messageOf = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Não foi possível concluir.';

// One conversation in the panel: the thread, who is in charge (assistant or a person), and the
// composer. Answering takes the conversation over; "Devolver ao assistente" gives it back.
export function ConversationView({
  token,
  conversationId,
  canReply,
}: {
  token: string;
  conversationId: string;
  canReply: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['whatsapp', 'conversation', conversationId],
    queryFn: () => whatsappApi.conversation(token, conversationId),
    refetchInterval: 2500,
  });
  const conversation = query.data;

  // Opening a conversation reads it.
  const unread = conversation?.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0) {
      void whatsappApi
        .markRead(token, conversationId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] }))
        .catch(() => undefined);
    }
  }, [unread, token, conversationId, queryClient]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversation', conversationId] });
    void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
    // The counters of the tabs (assistant / team) come with the settings.
    void queryClient.invalidateQueries({ queryKey: ['whatsapp', 'settings'] });
  };

  const send = useMutation({
    mutationFn: (body: string) => whatsappApi.reply(token, conversationId, body),
    onSuccess: () => {
      setText('');
      setError(null);
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : messageOf(e)),
  });
  const assume = useMutation({
    mutationFn: () => whatsappApi.assume(token, conversationId),
    onSuccess: () => {
      toast.success('Você assumiu o atendimento. O assistente não responde mais nesta conversa.');
      refresh();
    },
    onError: (e) => toast.error(messageOf(e)),
  });
  const release = useMutation({
    mutationFn: () => whatsappApi.release(token, conversationId),
    onSuccess: () => {
      toast.success('Conversa devolvida ao assistente.');
      refresh();
    },
    onError: (e) => toast.error(messageOf(e)),
  });

  if (query.isLoading) return <LoadingState label="Carregando conversa..." className="h-full" />;
  if (query.isError || !conversation)
    return <ErrorState message={messageOf(query.error)} onRetry={() => void query.refetch()} />;

  const blocked = replyBlock(conversation);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const problem = validateReply(text);
    if (problem) {
      setError(problem);
      return;
    }
    send.mutate(text.trim());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
          <p className="truncate font-semibold">{contactLabel(conversation.contact)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {formatWaId(conversation.contact.waId)}
          </p>
        </div>
        <Badge tone={conversation.status === 'AI' ? 'info' : 'warning'} dot>
          {conversation.status === 'AI'
            ? STATUS_LABEL.AI
            : conversation.assignedUser
              ? `Atendente: ${conversation.assignedUser.name}`
              : STATUS_LABEL.HUMAN}
        </Badge>
        {conversation.cartItems > 0 && (
          <Badge tone="neutral">
            <ShoppingCart className="mr-1 inline h-3 w-3" aria-hidden />
            {conversation.cartItems} {conversation.cartItems === 1 ? 'item' : 'itens'} no carrinho
          </Badge>
        )}
        {canReply &&
          (conversation.status === 'AI' ? (
            <Button
              size="sm"
              variant="outline"
              icon={<Headset className="h-4 w-4" />}
              loading={assume.isPending}
              onClick={() => assume.mutate()}
            >
              Assumir atendimento
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              icon={<Bot className="h-4 w-4" />}
              loading={release.isPending}
              onClick={() => release.mutate()}
            >
              Devolver ao assistente
            </Button>
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-surface-2">
        <ChatThread messages={conversation.messages} />
      </div>

      {canReply && (
        <form onSubmit={submit} className="space-y-2 border-t border-line p-3">
          {blocked ? (
            <Alert tone="warning">{blocked}</Alert>
          ) : (
            <>
              {conversation.status === 'AI' && (
                <p className="text-xs text-muted-foreground">
                  Ao responder, você assume a conversa e o assistente para de responder.
                </p>
              )}
              <div className="flex items-end gap-2">
                <label htmlFor="whatsapp-reply" className="sr-only">
                  Mensagem para o cliente
                </label>
                <Textarea
                  id="whatsapp-reply"
                  rows={2}
                  maxLength={MESSAGE_MAX}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={onKeyDown}
                  placeholder="Escreva uma resposta (Ctrl+Enter envia)"
                  className="min-h-[2.75rem] flex-1 resize-none"
                />
                <Button
                  type="submit"
                  icon={<Send className="h-4 w-4" />}
                  loading={send.isPending}
                  aria-label="Enviar resposta"
                >
                  Enviar
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-xs font-medium text-danger">
                  {error}
                </p>
              )}
            </>
          )}
        </form>
      )}
    </div>
  );
}
