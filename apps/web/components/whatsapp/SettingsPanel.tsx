'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, ShieldCheck } from 'lucide-react';
import type { WhatsappSettings } from '@/lib/whatsapp-api';
import { whatsappApi } from '@/lib/whatsapp-api';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Field, Input, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { Switch } from '@/components/ds/Switch';
import { useToast } from '@/components/ds/Toast';

// What the restaurant decides about its assistant. Prices, add-ons and availability are NOT here:
// the assistant only ever answers them from the menu.
export function SettingsPanel({
  token,
  data,
  canConfigure,
}: {
  token: string;
  data: WhatsappSettings;
  canConfigure: boolean;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = data.settings!;
  const [enabled, setEnabled] = useState(settings.assistantEnabled);
  const [greeting, setGreeting] = useState(settings.greetingMessage ?? '');
  const [behavior, setBehavior] = useState(settings.behaviorInstructions ?? '');
  const [limit, setLimit] = useState(String(settings.aiDailyReplyLimit));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(settings.assistantEnabled);
    setGreeting(settings.greetingMessage ?? '');
    setBehavior(settings.behaviorInstructions ?? '');
    setLimit(String(settings.aiDailyReplyLimit));
  }, [
    settings.assistantEnabled,
    settings.greetingMessage,
    settings.behaviorInstructions,
    settings.aiDailyReplyLimit,
  ]);

  const save = useMutation({
    mutationFn: () =>
      whatsappApi.updateSettings(token, {
        assistantEnabled: enabled,
        greetingMessage: greeting.trim() || null,
        behaviorInstructions: behavior.trim() || null,
        aiDailyReplyLimit: Number(limit),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(['whatsapp', 'settings'], next);
      toast.success('Configurações salvas.');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Não foi possível salvar.'),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const n = Number(limit);
    if (!Number.isInteger(n) || n < 0 || n > 10000) {
      setError('O limite diário deve ser um número inteiro de 0 a 10.000.');
      return;
    }
    setError(null);
    save.mutate();
  };

  const { usageToday, ai, connection } = data;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <Card>
        <CardHeader
          title="Assistente"
          description="Saudação, tom de atendimento e limite de uso."
        />
        <form onSubmit={submit} className="space-y-4 p-4 pt-0">
          <div className="flex items-start gap-3">
            <Switch
              checked={enabled}
              onChange={setEnabled}
              disabled={!canConfigure}
              label="Respostas automáticas do assistente"
            />
            <div>
              <p className="text-sm font-medium">
                {enabled ? 'Assistente ativado' : 'Assistente desativado'}
              </p>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? 'Responde as conversas sozinho e passa para a equipe quando o cliente pede.'
                  : 'As mensagens ficam esperando alguém da equipe responder.'}
              </p>
            </div>
          </div>
          <Field label="Saudação" hint="Enviada na primeira resposta de cada conversa.">
            <Textarea
              rows={2}
              maxLength={500}
              value={greeting}
              disabled={!canConfigure}
              onChange={(e) => setGreeting(e.target.value)}
            />
          </Field>
          <Field
            label="Comportamento"
            hint="Tom e orientações (ex.: “trate o cliente por você, ofereça bebida”). Não muda preços nem regras: esses vêm sempre do cardápio."
          >
            <Textarea
              rows={4}
              maxLength={1000}
              value={behavior}
              disabled={!canConfigure}
              onChange={(e) => setBehavior(e.target.value)}
            />
          </Field>
          <Field
            label="Limite de respostas por dia"
            hint="Ao atingir, as conversas passam para a equipe (controle de custo)."
          >
            <Input
              type="number"
              min={0}
              max={10000}
              inputMode="numeric"
              value={limit}
              disabled={!canConfigure}
              onChange={(e) => setLimit(e.target.value)}
              className="block max-w-[10rem]"
            />
          </Field>
          {error && <Alert>{error}</Alert>}
          {canConfigure ? (
            <Button type="submit" loading={save.isPending}>
              Salvar configurações
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Somente o dono ou um administrador altera estas configurações.
            </p>
          )}
        </form>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader title="Conexão" />
          <dl className="space-y-2 p-4 pt-0 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Número</dt>
              <dd className="font-medium">{connection?.displayPhoneNumber}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Tipo</dt>
              <dd>
                <Badge tone={connection?.mode === 'SIMULATED' ? 'neutral' : 'success'}>
                  {connection?.mode === 'SIMULATED' ? 'Simulado' : 'WhatsApp Cloud API'}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Envio real</dt>
              <dd>{data.cloudSendingEnabled ? 'ativado' : 'desativado neste ambiente'}</dd>
            </div>
          </dl>
          <div className="px-4 pb-4">
            <Alert tone="info">
              A conexão com um número real do WhatsApp será feita pela plataforma, depois da
              aprovação, com a conta oficial da Meta.
            </Alert>
          </div>
        </Card>
        <Card>
          <CardHeader title="Uso de hoje" />
          <dl className="space-y-2 p-4 pt-0 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="flex items-center gap-1 text-muted-foreground">
                <Bot className="h-4 w-4" aria-hidden /> Respostas do assistente
              </dt>
              <dd className="font-semibold tabular-nums">
                {usageToday.assistantReplies} / {settings.aiDailyReplyLimit}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Provedor de IA</dt>
              <dd>
                {ai.provider === 'local'
                  ? 'Assistente local (sem custo)'
                  : `${ai.provider}${ai.model ? ` · ${ai.model}` : ''}`}
              </dd>
            </div>
            {ai.provider !== 'local' && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Tokens (entrada / saída)</dt>
                <dd className="tabular-nums">
                  {usageToday.inputTokens.toLocaleString('pt-BR')} /{' '}
                  {usageToday.outputTokens.toLocaleString('pt-BR')}
                </dd>
              </div>
            )}
          </dl>
          <p className="flex items-start gap-1.5 px-4 pb-4 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Preços e valores enviados pelo assistente são sempre conferidos com o cardápio antes do
            envio.
          </p>
        </Card>
      </div>
    </div>
  );
}
