'use client';

import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Bot, Check, CheckCheck, Clock, Headset, Info, TriangleAlert } from 'lucide-react';
import type { ChatMessage } from '@/lib/whatsapp-api';
import {
  AUTHOR_LABEL,
  DELIVERY_LABEL,
  boldSegments,
  failureReason,
  timeLabel,
} from '@/lib/whatsapp-logic';

function StatusIcon({ message }: { message: ChatMessage }) {
  if (message.direction !== 'OUTBOUND') return null;
  const label = DELIVERY_LABEL[message.status];
  if (message.status === 'FAILED')
    return <TriangleAlert className="h-3.5 w-3.5 text-danger" aria-label={label} />;
  if (message.status === 'QUEUED') return <Clock className="h-3.5 w-3.5" aria-label={label} />;
  if (message.status === 'SENT') return <Check className="h-3.5 w-3.5" aria-label={label} />;
  return (
    <CheckCheck
      className={clsx('h-3.5 w-3.5', message.status === 'READ' && 'text-info')}
      aria-label={label}
    />
  );
}

function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
      {boldSegments(text).map((part, i) =>
        part.bold ? (
          <strong key={i} className="font-semibold">
            {part.text}
          </strong>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </p>
  );
}

// The messages of one conversation, oldest first, as the customer sees them on the phone (left)
// and as the restaurant answered (right: assistant, a person, or a system notice).
export function ChatThread({
  messages,
  compact = false,
}: {
  messages: ChatMessage[];
  compact?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1]?.id;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [last]);

  return (
    <div
      className={clsx('flex flex-col gap-2', compact ? 'p-3' : 'p-4')}
      role="log"
      aria-live="polite"
      aria-label="Mensagens da conversa"
    >
      {messages.map((m) => {
        const outbound = m.direction === 'OUTBOUND';
        const failure = failureReason(m);
        return (
          <div key={m.id} className={clsx('flex', outbound ? 'justify-end' : 'justify-start')}>
            <div
              className={clsx(
                'max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ring-1',
                outbound
                  ? m.author === 'SYSTEM'
                    ? 'rounded-br-md bg-warning/10 ring-warning/25'
                    : 'rounded-br-md bg-success/10 ring-success/25'
                  : 'rounded-bl-md bg-surface ring-line',
              )}
            >
              {outbound && (
                <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                  {m.author === 'ASSISTANT' ? (
                    <Bot className="h-3 w-3" aria-hidden />
                  ) : m.author === 'AGENT' ? (
                    <Headset className="h-3 w-3" aria-hidden />
                  ) : (
                    <Info className="h-3 w-3" aria-hidden />
                  )}
                  {m.author === 'AGENT' && m.authorName ? m.authorName : AUTHOR_LABEL[m.author]}
                </p>
              )}
              <Body text={m.body} />
              <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
                <span>{timeLabel(m.at)}</span>
                <StatusIcon message={m} />
              </p>
              {failure && (
                <p className="mt-1 text-[11px] font-medium text-danger">Não enviada: {failure}.</p>
              )}
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
