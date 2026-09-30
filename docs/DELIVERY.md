# Delivery (Fase 10 — fatias 1 e 2)

Estado real implementado em 2026-09-30. A **fatia 1** trouxe taxa de entrega, configuração por unidade, registro operacional da entrega e o fluxo despachar → entregar. A **fatia 2** acrescentou falha de entrega, reentrega, observação da entrega, filtros/busca e paginação na tela. O que não está aqui está listado em "Limitações".

## Arquitetura

O pedido (`Order`) já guardava `fulfillmentType = DELIVERY` e o **endereço como snapshot** (rua, número, complemento, bairro, cidade, UF, CEP). Isso foi reaproveitado; nada foi duplicado.

| O quê | Onde | Para quê |
|---|---|---|
| `Delivery` (tabela `deliveries`, 1:1 com o pedido) | `schema.prisma` | estado **operacional** da entrega, tentativas, falha, observação e quem despachou/concluiu |
| `DeliveryStatus` | enum | `PENDING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `CANCELLED` |
| `Delivery.notes` | coluna (≤ 300) | **observação da entrega** ("Portão azul"), separada de `Order.notes` |
| `Delivery.attemptCount`, `failedAt`, `failureReason` | colunas | nº de despachos e **última** falha (o histórico completo fica no `AuditLog`) |
| `Order.deliveryFeeCents` | coluna | snapshot da taxa cobrada; `totalCents = subtotalCents + deliveryFeeCents` |
| `Branch.deliveryEnabled`, `deliveryFeeCents`, `deliveryMinOrderCents` | colunas | configuração de entrega por unidade |
| módulo `delivery` | `apps/api/src/modules/delivery` | listagem, ações, observação e configurações |
| `/dashboard/delivery` | `apps/web` | tela operacional |

### OrderStatus × DeliveryStatus

Os dois são **independentes, mas andam juntos** para pedidos de entrega:

| Pedido (`OrderStatus`) | Entrega (`DeliveryStatus`) |
|---|---|
| `PENDING`, `CONFIRMED`, `PREPARING` | `PENDING` |
| `READY` | `PENDING` (aguardando despacho) **ou** `FAILED` (tentativa que não deu certo) |
| `OUT_FOR_DELIVERY` | `OUT_FOR_DELIVERY` |
| `DELIVERED` | `DELIVERED` |
| `CANCELLED` | `CANCELLED` |

- `OrderStatus` é a linha do tempo comercial (o que o cliente vê na página do pedido). `DeliveryStatus` é o estado operacional.
- **Escritor único:** para pedidos de entrega, só o `DeliveryService` leva o pedido por `READY → OUT_FOR_DELIVERY → DELIVERED` (e de volta a `READY` numa falha), sempre na **mesma transação** da entrega. O endpoint genérico `PATCH /orders/:id/status` continua recusando `OUT_FOR_DELIVERY` e `DELIVERED` (`INVALID_STATUS_TRANSITION`) e recusa `COMPLETED` para pedido de entrega (`409 DELIVERY_FLOW_REQUIRED`).
- **Uma falha nunca cancela o pedido.** Ela devolve o pedido a `READY` e a entrega a `FAILED`; quem decide o que fazer é uma pessoa: pedir nova tentativa ou cancelar o pedido (abaixo).
- Pedidos de retirada (`PICKUP`) e de mesa (`DINE_IN`) **não têm** entrega e seguem o fluxo antigo (`READY → COMPLETED`).

### Transições da entrega

```
PENDING ──dispatch──▶ OUT_FOR_DELIVERY ──complete──▶ DELIVERED
   ▲                        │
   │                      fail (motivo obrigatório)
   └──── redeliver ──── FAILED ◀─┘

PENDING ──(cancelar o pedido)──▶ CANCELLED      FAILED ──(cancelar o pedido)──▶ CANCELLED
```

- `dispatch`: entrega `PENDING` **e** pedido `READY` (`409 ORDER_NOT_READY_FOR_DISPATCH` caso contrário); soma 1 em `attemptCount`.
- `complete`: entrega `OUT_FOR_DELIVERY`.
- `fail`: entrega `OUT_FOR_DELIVERY`; exige `reason` (3 a 300 caracteres); pedido `OUT_FOR_DELIVERY → READY`.
- `redeliver`: entrega `FAILED → PENDING`; o pedido continua `READY`; limpa `failedAt`/`failureReason` (o histórico está no audit).
- **Cancelar depois de uma falha:** `PATCH /orders/:id/status` com `CANCELLED` passa a ser aceito para um pedido `READY` **somente se a entrega estiver `FAILED`** — é a única exceção às regras do pedido. Exige `orders.cancel` (o papel `DELIVERY` não tem), estorna o estoque como qualquer cancelamento e cancela a entrega na mesma transação. Com a entrega `PENDING` (inclusive após pedir reentrega) o pedido `READY` continua não podendo ser cancelado.
- Qualquer outra combinação: `409 INVALID_DELIVERY_TRANSITION`. `DELIVERED` e `CANCELLED` são finais.

**Reentrega = mesmo registro.** Não há tabela de tentativas: o `AuditLog` já guarda, em ordem, `DELIVERY_DISPATCHED` (com `attempt`), `DELIVERY_FAILED` (com `reason`) e `DELIVERY_REDELIVERY_REQUESTED`.

## Taxa, pedido mínimo e total (fonte única: servidor)

Calculados em `OrderCreationService.createPricedOrderInTx` por `priceDelivery` (`delivery-pricing.ts`), a partir das configurações da **unidade que recebe o pedido** e do subtotal que o próprio servidor calculou. O cliente não envia nem influencia a taxa (campos extras no corpo são descartados).

- Tudo em **centavos inteiros**. Sem `float`.
- Entrega desabilitada → `400 DELIVERY_UNAVAILABLE` (retirada continua funcionando).
- Soma dos itens menor que o mínimo → `400 DELIVERY_MIN_ORDER_NOT_MET` (`details.minOrderCents`). O mínimo compara só os itens, sem a taxa.
- Total acima de 2.147.483.647 centavos → `400 ORDER_TOTAL_TOO_LARGE`.
- A taxa cobrada fica gravada no pedido: mudar a configuração depois **não altera pedidos existentes**.
- A criação do pedido e da entrega acontece na mesma transação.

## Observação da entrega

- Campo próprio `Delivery.notes` (até 300 caracteres, validado na API e por `CHECK` no banco), **independente** de `Order.notes`.
- Nasce no checkout público (`deliveryNotes`, opcional, ignorado em retirada) e pode ser editada pela operação com `PATCH /delivery/:id/notes` (`{ "notes": "texto" }`; `null` ou texto em branco limpa; a chave é obrigatória para um corpo vazio não apagar nada).
- Editável enquanto a entrega está viva (`PENDING`, `OUT_FOR_DELIVERY`, `FAILED`); `DELIVERED`/`CANCELLED` são somente leitura (`409 DELIVERY_NOTES_LOCKED`).
- Gravar o mesmo valor é um replay (200, `idempotentReplay: true`, sem auditoria).

## Endpoints (todos exigem autenticação; `tenantId` vem do token)

| Método e rota | Permissão | Descrição |
|---|---|---|
| `GET /v1/delivery?branchId=&status=&orderStatus=&search=&dateFrom=&dateTo=&page=&pageSize=` | `delivery.read` | lista as entregas da unidade, com `summary` por status |
| `POST /v1/delivery/:id/dispatch` | `delivery.update` | despacha; idempotente |
| `POST /v1/delivery/:id/complete` | `delivery.update` | confirma a entrega; idempotente |
| `POST /v1/delivery/:id/fail` | `delivery.update` | registra a falha (`{ reason }`); idempotente |
| `POST /v1/delivery/:id/redeliver` | `delivery.update` | pede nova tentativa (`FAILED → PENDING`); idempotente |
| `PATCH /v1/delivery/:id/notes` | `delivery.update` | define/limpa a observação da entrega |
| `GET /v1/delivery/settings?branchId=` | `delivery.read` | configurações da unidade |
| `PUT /v1/delivery/settings` | `delivery.configure` | substitui `enabled`, `feeCents` (0–1.000.000) e `minOrderCents` (0–100.000.000) |

**Filtros da listagem** (todos no backend):
- `status`: status da entrega; `orderStatus`: status do pedido.
- `search`: número do pedido **ou** nome do cliente, contém, sem diferenciar maiúsculas (máx. 120 caracteres). `%` e `_` são tratados como texto comum.
- `dateFrom`/`dateTo`: data de criação, instantes ISO (a tela envia o início e o fim do dia **local**); uma data simples `YYYY-MM-DD` no `dateTo` significa "até o fim desse dia UTC".
- O `summary` (contadores das abas) respeita todos os filtros **exceto** `status`.
- A filial vem do seletor global da tela (`branchId` obrigatório; sem acesso → 403).

**Paginação:** `page` (1 a 1000) e `pageSize` (1 a 100, padrão 20). Ordenação total e estável: `createdAt` (crescente em `PENDING`/`OUT_FOR_DELIVERY`, decrescente nos demais) e `id` como desempate. O offset máximo é de 100.000 linhas.

Também mudaram (campos aditivos): `GET /orders` e `GET /orders/:id` trazem `deliveryFee` e `delivery { id, status, notes }`; `POST /public/orders` aceita `deliveryNotes` e, com a página pública do pedido, devolve `deliveryFee`; `GET /public/menu/:slug` traz `delivery { enabled, fee, minOrder }` (em reais, só informativo para o checkout).

Nas respostas do módulo `delivery`, valores monetários são **centavos**; nas respostas antigas de pedido continuam em reais. Os campos de observação chamam-se `orderNotes` (do pedido) e `deliveryNotes` (da entrega).

## Permissões

| Permissão | OWNER | ADMIN | MANAGER | DELIVERY | demais |
|---|---|---|---|---|---|
| `delivery.read` | ✔ | ✔ | ✔ | ✔ | — |
| `delivery.update` (despachar, concluir, falha, reentrega, observação) | ✔ | ✔ | ✔ | ✔ | — |
| `delivery.configure` | ✔ | ✔ | ✔ | — | — |
| `orders.cancel` (cancelar o pedido após falha) | ✔ | ✔ | ✔ | — | — |

Nenhuma permissão nova na fatia 2. As permissões entram pelo **seed** (`pnpm db:seed`): depois de migrar um banco existente, rode o seed. Sem ele, ninguém tem acesso ao módulo.

## Isolamento e concorrência

- Tenant: sempre filtrado pelo token; entrega/configuração de outro tenant responde 404.
- Unidade: `BranchAccessService` na listagem e nas configurações (403 sem acesso); nas ações por id, entrega de unidade sem acesso responde 404.
- Despachar, concluir, falhar e pedir reentrega travam **primeiro o pedido e depois a entrega** (`SELECT … FOR UPDATE`), a mesma ordem usada ao cancelar o pedido, e leem o estado **depois** do lock. Uma requisição repetida ou simultânea encontra o destino já alcançado e responde **200 com `idempotentReplay: true`**, sem escrever nada; movimento impossível responde 409.
- A idempotência é **por estado**, não por tentativa: um duplicado atrasado de uma tentativa anterior é indistinguível de uma repetição. `redeliver` só conta como replay se já houve uma tentativa (`PENDING` também é o estado inicial).

## Auditoria

Gravada **dentro da transação** (`AuditService.recordTx`): se a auditoria falhar, a operação inteira sofre rollback.

| Evento | Quando |
|---|---|
| `DELIVERY_DISPATCHED` / `DELIVERY_COMPLETED` (entidade `Delivery`) | ao despachar (com `attempt`) / concluir |
| `DELIVERY_FAILED` (`Delivery`) | ao falhar; `afterData` com `reason` e `attempt` |
| `DELIVERY_REDELIVERY_REQUESTED` (`Delivery`) | ao pedir nova tentativa |
| `ORDER_STATUS_CHANGED` (`via: DELIVERY`) | quando o pedido muda junto com a entrega (despacho, conclusão, falha) |
| `DELIVERY_NOTES_UPDATED` (`Delivery`) | ao alterar a observação (antes/depois) |
| `DELIVERY_CANCELLED` (entidade `Order`) | ao cancelar um pedido de entrega; `beforeData` traz o status anterior da entrega (`PENDING` ou `FAILED`) |
| `DELIVERY_SETTINGS_UPDATED` (`Branch`) | ao alterar as configurações (antes/depois) |

## Migrations

- `20260930120000_delivery` (fatia 1): `DeliveryStatus`, `deliveries`, colunas de taxa/configuração, `CHECK`s de valores não negativos e **backfill** dos pedidos de entrega existentes (`CANCELLED → CANCELLED`; `COMPLETED`/`DELIVERED → DELIVERED`; `OUT_FOR_DELIVERY → OUT_FOR_DELIVERY`; demais → `PENDING`; horários e responsáveis históricos ficam nulos).
- `20260930130000_delivery_operations` (fatia 2): valor `FAILED` no enum, colunas `notes`, `attemptCount`, `failedAt`, `failureReason`, `CHECK`s (observação e motivo ≤ 300, tentativas ≥ 0) e backfill `attemptCount = 1` onde já havia despacho registrado (linhas históricas sem despacho ficam em 0).
- Nenhuma apaga ou reescreve dados existentes.

## Frontend

`/dashboard/delivery`: abas por status (Pendente, Em rota, Falhou, Entregue, Cancelada) com contagem; busca por número/cliente, filtro por situação do pedido e por dia; "Limpar filtros"; tabela com endereço, **Entrega:** (observação da entrega), **Pedido:** (observação do pedido) e motivo da falha; paginação; polling a cada 15 s.

Ações (o backend é a autoridade; a tela só habilita o que o servidor informa): **Despachar** / **Despachar novamente**, **Confirmar entrega**, **Marcar como falha** (diálogo com motivo obrigatório), **Solicitar reentrega** e **Cancelar pedido** (ambos com confirmação; o cancelamento só para gerência), editar observação. Um guard síncrono por entrega evita requisições repetidas em cliques duplos. Estados de carregando, erro (com "Tentar novamente") e vazio (inclusive "nenhuma entrega encontrada" com filtros ativos).

Checkout público: mostra taxa e pedido mínimo, soma a taxa ao total exibido, desabilita "Entrega" quando a unidade não aceita e tem o campo "Instruções para a entrega", separado das observações do pedido. Detalhe do pedido: mostra a taxa e as instruções de entrega. KDS e detalhe do pedido: pedido de entrega `READY` não oferece "Finalizar".

## Limitações (não implementado)

- Atribuição de entregador, entregador externo, rastreamento/GPS, mapas, raio ou distância.
- Taxa por bairro/zona/distância: há UMA taxa por unidade.
- Histórico de tentativas em tabela própria: só o `AuditLog` (a tela mostra a última falha e o número da tentativa, não a linha do tempo).
- PDV não cria pedidos de entrega.
- O checkout público usa sempre a unidade mais antiga e ativa (comportamento anterior); as configurações lidas são as dessa unidade.
- Cancelar o pedido só é possível a partir de `READY` quando a entrega está `FAILED`; com a entrega `PENDING` após uma reentrega pedida não há cancelamento (despache e, se falhar, cancele).
- Busca apenas por número do pedido e nome do cliente (não por telefone ou endereço); filtro de data pelo dia da criação do pedido.
- Notificações (WhatsApp/push) e pagamento online.

## Decisões

- Tabela própria para a entrega (em vez de só usar `OrderStatus`), para manter o operacional separado do comercial.
- Falha devolve o pedido a `READY` em vez de deixá-lo "saiu para entrega" ou cancelá-lo: o cliente não vê uma entrega em rota que não existe e ninguém perde o pedido sem decisão humana.
- Reentrega reutiliza o mesmo registro; o histórico fica no audit (sem tabela de tentativas).
- Paginação por offset limitada (100 por página, 1000 páginas): suficiente para o volume de uma unidade e mais simples que cursor; o desempate por `id` mantém a ordem estável.
