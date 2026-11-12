'use client';

import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { FlaskConical, Send, Smartphone } from 'lucide-react';
import { whatsappApi } from '@/lib/whatsapp-api';
import { MESSAGE_MAX, STATUS_LABEL, validateReply } from '@/lib/whatsapp-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Field, Input } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { ChatThread } from './ChatThread';

// Fictitious customers: the simulator never touches a real number.
const PRESETS = [
  { name: 'Ana (teste)', phone: '90000-0001' },
  { name: 'Bruno (teste)', phone: '90000-0002' },
];

const SUGGESTIONS = [
  'oi',
  'cardápio',
  'quero 2 X com bacon sem cebola',
  'qual a taxa de entrega?',
  'horário',
  'carrinho',
  'fechar',
  'sim',
  'quero falar com um atendente',
];

// A customer's phone, for testing: each message goes through the same path as a message from
// Meta (webhook payload -> queue -> assistant -> reply), on the restaurant's simulated number.
export function SimulatorPanel({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [contact, setContact] = useState(PRESETS[0]);
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [conversationByPhone, setConversationByPhone] = useState<Record<string, string>>({});
  const conversationId = conversationByPhone[contact.phone] ?? null;

  const thread = useQuery({
    queryKey: ['whatsapp', 'conversation', conversationId],
    queryFn: () => whatsappApi.conversation(token, conversationId!),
    enabled: !!conversationId,
    refetchInterval: 1200,
  });

  const send = useMutation({
    mutationFn: (body: string) =>
      whatsappApi.simulate(token, {
        contactName: contact.name,
        contactPhone: contact.phone,
        text: body,
      }),
    onSuccess: (result) => {
      setText('');
      setError(null);
      if (result.conversationId)
        setConversationByPhone((prev) => ({ ...prev, [contact.phone]: result.conversationId! }));
      void queryClient.invalidateQueries({ queryKey: ['whatsapp'] });
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Não foi possível simular a mensagem.'),
  });

  const submit = (event?: FormEvent, body = text) => {
    event?.preventDefault();
    const problem = validateReply(body);
    if (problem) {
      setError(problem);
      return;
    }
    send.mutate(body.trim());
  };

  const messages = thread.data?.messages ?? [];
  const lastIsCustomer =
    messages.length > 0 && messages[messages.length - 1].direction === 'INBOUND';
  const waiting = send.isPending || (lastIsCustomer && thread.data?.status === 'AI');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <Card className="h-max">
        <CardHeader
          title="Simulador de conversas"
          description="Teste o assistente como se fosse um cliente. Nada é enviado ao WhatsApp: o número é simulado."
        />
        <div className="space-y-4 p-4 pt-0">
          <div>
            <p className="mb-2 text-sm font-medium">Cliente</p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cliente simulado">
              {PRESETS.map((p) => (
                <button
                  key={p.phone}
                  type="button"
                  role="radio"
                  aria-checked={!custom && contact.phone === p.phone}
                  onClick={() => {
                    setCustom(false);
                    setContact(p);
                  }}
                  className={clsx(
                    'rounded-full border px-3 py-1.5 text-sm',
                    !custom && contact.phone === p.phone
                      ? 'border-primary bg-primary/10 font-semibold'
                      : 'border-line hover:bg-surface-hover',
                  )}
                >
                  {p.name}
                </button>
              ))}
              <button
                type="button"
                role="radio"
                aria-checked={custom}
                onClick={() => {
                  setCustom(true);
                  setContact({ name: 'Cliente (teste)', phone: '90000-0099' });
                }}
                className={clsx(
                  'rounded-full border px-3 py-1.5 text-sm',
                  custom
                    ? 'border-primary bg-primary/10 font-semibold'
                    : 'border-line hover:bg-surface-hover',
                )}
              >
                Outro
              </button>
            </div>
          </div>
          {custom && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome do cliente">
                <Input
                  value={contact.name}
                  maxLength={60}
                  onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
                />
              </Field>
              <Field label="Telefone fictício" hint="Só para separar as conversas.">
                <Input
                  value={contact.phone}
                  maxLength={20}
                  onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))}
                />
              </Field>
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-medium">Mensagens prontas</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={send.isPending}
                  onClick={() => submit(undefined, s)}
                  className="rounded-full bg-surface-hover px-3 py-1.5 text-xs font-medium hover:bg-line disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <Alert tone="info">
            As respostas usam o cardápio real deste restaurante (preços, adicionais,
            disponibilidade). O link de checkout abre o carrinho no cardápio público, mas nenhum
            pedido é criado sem a confirmação no checkout.
          </Alert>
        </div>
      </Card>

      <div className="mx-auto w-full max-w-[420px] overflow-hidden rounded-[2rem] border-[10px] border-foreground/85 bg-surface shadow-xl">
        <div className="flex items-center gap-2 bg-success px-4 py-3 text-white">
          <Smartphone className="h-4 w-4" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{contact.name}</p>
            <p className="text-[11px] opacity-90">conversa simulada</p>
          </div>
          {thread.data && (
            <Badge tone={thread.data.status === 'AI' ? 'info' : 'warning'} className="bg-white/90">
              {STATUS_LABEL[thread.data.status]}
            </Badge>
          )}
        </div>
        <div className="h-[460px] overflow-y-auto bg-surface-2">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <FlaskConical className="h-6 w-6" aria-hidden />
              Envie uma mensagem como cliente para começar.
            </div>
          ) : (
            <ChatThread messages={messages} compact />
          )}
        </div>
        {waiting && (
          <p className="bg-surface-2 px-4 pb-2 text-xs italic text-muted-foreground">
            assistente digitando...
          </p>
        )}
        <form
          onSubmit={submit}
          className="flex items-center gap-2 border-t border-line bg-surface p-2"
        >
          <label htmlFor="simulator-text" className="sr-only">
            Mensagem do cliente
          </label>
          <Input
            id="simulator-text"
            value={text}
            maxLength={MESSAGE_MAX}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            placeholder="Mensagem do cliente"
            className="flex-1"
            autoComplete="off"
          />
          <Button
            type="submit"
            size="icon"
            icon={<Send className="h-4 w-4" />}
            loading={send.isPending}
            aria-label="Enviar como cliente"
          />
        </form>
        {error && (
          <p role="alert" className="bg-surface px-3 pb-2 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
