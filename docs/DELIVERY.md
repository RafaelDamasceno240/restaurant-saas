# Delivery (Fase 10 — fatias 1, 2 e 3 + hardening final)

Estado real implementado em 2026-09-30. A **fatia 1** trouxe taxa de entrega, configuração por unidade, registro operacional da entrega e o fluxo despachar → entregar. A **fatia 2** acrescentou falha de entrega, reentrega, observação da entrega, filtros/busca e paginação na tela. A **fatia 3** acrescentou a **atribuição de entregador interno** e o **histórico operacional de tentativas** (reconstruído do `AuditLog`). O que não está aqui está listado em "Limitações".

## Arquitetura

O pedido (`Order`) já guardava `fulfillmentType = DELIVERY` e o **endereço como snapshot** (rua, número, complemento, bairro, cidade, UF, CEP). Isso foi reaproveitado; nada foi duplicado.

| O quê | Onde | Para quê |
|---|---|---|
| `Delivery` (tabela `deliveries`, 1:1 com o pedido) | `schema.prisma` | estado **operacional** da entrega, tentativas, falha, observação e quem despachou/concluiu |
| `DeliveryStatus` | enum | `PENDING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `CANCELLED` |
| `Delivery.notes` | coluna (≤ 300) | **observação da entrega** ("Portão azul"), separada de `Order.notes` |
| `Delivery.attemptCount`, `failedAt`, `failureReason` | colunas | nº de despachos e **última** falha (o histórico completo fica no `AuditLog`) |
| `Delivery.courierUserId`, `assignedAt` | colunas (nulas) | entregador responsável (um `User` do mesmo tenant com o papel `DELIVERY`) e quando foi atribuído; FK `RESTRICT` para `users` |
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
| `GET /v1/delivery?branchId=&status=&orderStatus=&search=&courier=&dateFrom=&dateTo=&page=&pageSize=` | `delivery.read` | lista as entregas da unidade, com `summary` por status |
| `POST /v1/delivery/:id/dispatch` | `delivery.update` | despacha; idempotente |
| `POST /v1/delivery/:id/complete` | `delivery.update` | confirma a entrega; idempotente |
| `POST /v1/delivery/:id/fail` | `delivery.update` | registra a falha (`{ reason }`); idempotente |
| `POST /v1/delivery/:id/redeliver` | `delivery.update` | pede nova tentativa (`FAILED → PENDING`); idempotente |
| `PATCH /v1/delivery/:id/notes` | `delivery.update` | define/limpa a observação da entrega |
| `PUT /v1/delivery/:id/courier` | `delivery.assign` | atribui ou reatribui o entregador (`{ courierUserId }`); idempotente |
| `DELETE /v1/delivery/:id/courier` | `delivery.assign` | remove o entregador; idempotente |
| `GET /v1/delivery/couriers?branchId=` | `delivery.assign` | entregadores elegíveis da unidade (máx. 200) |
| `GET /v1/delivery/:id/history` | `delivery.read` | linha do tempo da entrega (tentativas, falhas, atribuições) |
| `GET /v1/delivery/settings?branchId=` | `delivery.read` | configurações da unidade |
| `PUT /v1/delivery/settings` | `delivery.configure` | substitui `enabled`, `feeCents` (0–1.000.000) e `minOrderCents` (0–100.000.000) |

**Filtros da listagem** (todos no backend):
- `status`: status da entrega; `orderStatus`: status do pedido.
- `courier`: `me` (o usuário logado), `none` (sem entregador) ou o id de um entregador. Outro valor → 400. O `summary` respeita este filtro.
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
| `delivery.assign` (atribuir, reatribuir e remover entregador; listar entregadores) | ✔ | ✔ | ✔ | — | — |
| `orders.cancel` (cancelar o pedido após falha) | ✔ | ✔ | ✔ | — | — |

A fatia 3 criou `delivery.assign`: `delivery.update` e `delivery.configure` não distinguem o entregador da gerência (o papel DELIVERY tem `update`), e o entregador **não pode atribuir ninguém, nem a si mesmo**. Depois de migrar, rode o seed e os usuários precisam entrar de novo. As permissões entram pelo **seed** (`pnpm db:seed`): depois de migrar um banco existente, rode o seed. Sem ele, ninguém tem acesso ao módulo.

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
| `DELIVERY_ASSIGNED` / `DELIVERY_REASSIGNED` / `DELIVERY_UNASSIGNED` (`Delivery`) | ao atribuir / trocar / remover o entregador; `beforeData.courierUserId` e `afterData` com `courierUserId`, `previousCourierUserId`, `status`, `orderId`, `orderNumber`, `branchId` |
| `DELIVERY_SETTINGS_UPDATED` (`Branch`) | ao alterar as configurações (antes/depois) |

## Migrations

- `20260930120000_delivery` (fatia 1): `DeliveryStatus`, `deliveries`, colunas de taxa/configuração, `CHECK`s de valores não negativos e **backfill** dos pedidos de entrega existentes (`CANCELLED → CANCELLED`; `COMPLETED`/`DELIVERED → DELIVERED`; `OUT_FOR_DELIVERY → OUT_FOR_DELIVERY`; demais → `PENDING`; horários e responsáveis históricos ficam nulos).
- `20260930130000_delivery_operations` (fatia 2): valor `FAILED` no enum, colunas `notes`, `attemptCount`, `failedAt`, `failureReason`, `CHECK`s (observação e motivo ≤ 300, tentativas ≥ 0) e backfill `attemptCount = 1` onde já havia despacho registrado (linhas históricas sem despacho ficam em 0).
- `20260930140000_delivery_courier` (fatia 3): colunas `courierUserId` e `assignedAt` (nulas), índice `(tenantId, courierUserId)` e FK `RESTRICT` para `users`. Sem backfill: entregas existentes ficam sem entregador.
- Nenhuma apaga ou reescreve dados existentes.

## Frontend

`/dashboard/delivery`: abas por status (Pendente, Em rota, Falhou, Entregue, Cancelada) com contagem; busca por número/cliente, filtro por situação do pedido e por dia; "Limpar filtros"; tabela com endereço, **Entrega:** (observação da entrega), **Pedido:** (observação do pedido) e motivo da falha; paginação; polling a cada 15 s.

Ações (o backend é a autoridade; a tela só habilita o que o servidor informa): **Despachar** / **Despachar novamente**, **Confirmar entrega**, **Marcar como falha** (diálogo com motivo obrigatório), **Solicitar reentrega** e **Cancelar pedido** (ambos com confirmação; o cancelamento só para gerência), editar observação. Um guard síncrono por entrega evita requisições repetidas em cliques duplos. Estados de carregando, erro (com "Tentar novamente") e vazio (inclusive "nenhuma entrega encontrada" com filtros ativos).

Checkout público: mostra taxa e pedido mínimo, soma a taxa ao total exibido, desabilita "Entrega" quando a unidade não aceita e tem o campo "Instruções para a entrega", separado das observações do pedido. Detalhe do pedido: mostra a taxa e as instruções de entrega. KDS e detalhe do pedido: pedido de entrega `READY` não oferece "Finalizar".

## Limitações (não implementado)

- Entregador externo/terceirizado, rastreamento/GPS, mapas, raio ou distância (o entregador é sempre um usuário interno com o papel `DELIVERY`).
- Taxa por bairro/zona/distância: há UMA taxa por unidade.
- Histórico de tentativas em tabela própria: não existe; a linha do tempo é reconstruída do `AuditLog` (até 500 eventos por entrega), e o nº da tentativa é **derivado** contando os despachos. Eventos de entregas anteriores ao deploy não trazem `courierUserId` no audit.
- A atribuição é **organizacional**: não restringe quem pode despachar, falhar ou concluir (comportamento da fatia 2 mantido). "Minhas entregas" é um filtro, não uma barreira de segurança.
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

## Atribuição de entregador (fatia 3)

**Quem pode ser entregador:** usuário do **mesmo tenant**, `ACTIVE`, com o papel `DELIVERY` e acesso à unidade da entrega (vínculo em `UserBranch`; OWNER/ADMIN que também tenham o papel `DELIVERY` valem para todas as unidades, como no `BranchAccessService`). O tenant e a unidade vêm da sessão e da própria entrega, nunca do corpo; o cliente só informa o `courierUserId`. Não há tabela de entregadores nem entregador externo.

**Erros:** usuário de outro tenant ou inexistente → `404 COURIER_NOT_FOUND`; usuário do tenant que não serve → `409 COURIER_NOT_ELIGIBLE` com `details.reason` = `INACTIVE`, `NOT_COURIER` ou `NO_BRANCH_ACCESS`; entrega concluída ou cancelada → `409 DELIVERY_ASSIGNMENT_LOCKED`. A elegibilidade é verificada **dentro da transação**, depois dos locks.

**Quando muda:** só enquanto a entrega está viva (`PENDING`, `OUT_FOR_DELIVERY`, `FAILED`). Atribuir o mesmo entregador, ou remover quando não há nenhum, é replay (200, `idempotentReplay: true`, sem auditoria; vale também em entrega concluída). Despachar **não exige** entregador.

**Comportamento do entregador no ciclo de vida:**

| Evento | Entregador |
|---|---|
| Falha (`OUT_FOR_DELIVERY → FAILED`) | mantido; o pedido volta a `READY` (fatia 2) |
| Reentrega (`FAILED → PENDING`) | mantido; pode ser trocado antes de despachar de novo |
| Conclusão | mantido (registro de quem ficou responsável) e travado |
| Cancelamento do pedido | mantido e travado; fica no histórico |
| Reatribuição em rota | permitida; a troca fica no histórico |

**Concorrência:** atribuir/remover usam a mesma ordem de locks dos demais movimentos (pedido e depois entrega, `SELECT … FOR UPDATE`), releem o estado depois do lock e gravam a auditoria na mesma transação. Testado: 10 atribuições simultâneas (mesmo e diferentes entregadores), 10 remoções, e corridas com despachar, falhar, reentrega e cancelamento.

**Histórico:** `GET /delivery/:id/history` lê o `AuditLog` (`Delivery`/`entityId` + `DELIVERY_CANCELLED`, que é gravado na entidade `Order`), adiciona um evento sintético "criado" e resolve nomes (atores e entregadores) com uma consulta no tenant. Cada evento traz `kind`, `at`, `attempt` (só nos eventos de despacho, falha, reentrega e conclusão), `reason` (falhas), `actor`, `courier`, `previousCourier`. Os eventos de despacho/falha/conclusão/reentrega passaram a gravar também o `courierUserId` vigente (campo aditivo).

**Tela:** coluna **Entregador** ("Sem entregador" quando vazio); filtro de entregador (Todos, Minhas entregas — só para quem tem o papel DELIVERY —, Sem entregador e cada entregador da unidade); usuário com DELIVERY e sem papel de gerência abre em "Minhas entregas" (pode trocar para "Todos"); ações **Atribuir / Reatribuir / Remover** (gerência, com `canAssign` do servidor) e **Histórico** (linha do tempo em diálogo) para todos que veem a tela. Guard síncrono contra cliques duplos também nas novas ações.

## Fechamento da Fase 10 (hardening)

Revisão final sem mudança de comportamento em produção; o que foi acrescentado são testes (`apps/api/test/delivery-hardening.e2e-spec.ts`) e este checklist.

**Nomes reais das permissões:** `delivery.read`, `delivery.update`, `delivery.configure` (configurações da unidade; não existe `delivery.settings`) e `delivery.assign`. Matriz efetiva confirmada no banco após o seed: OWNER/ADMIN/MANAGER têm as quatro; DELIVERY tem `read` e `update`; CASHIER, WAITER, KITCHEN e VIEWER não têm nenhuma.

**Pares válidos (entrega/pedido):** `PENDING/{PENDING,CONFIRMED,PREPARING,READY}`, `OUT_FOR_DELIVERY/OUT_FOR_DELIVERY`, `DELIVERED/DELIVERED`, `FAILED/READY`, `CANCELLED/CANCELLED`. Testado com corridas repetidas: despachar × falhar, despachar × concluir, falhar × concluir, reentrega × cancelar, cancelar × despachar e cancelar × atribuir. Nenhuma combinação deixa um par fora desta lista.

**Cancelamento:** só pelo pedido (`PATCH /orders/:id/status`), com `orders.cancel`. Pedido em rota (`OUT_FOR_DELIVERY`) não cancela (409); pedido `READY` só cancela quando a entrega está `FAILED`. Depois de cancelada, nenhuma operação (despachar, concluir, falhar, reentrega, atribuir, observação, mudança de status do pedido) é aceita: todas respondem 409 e nada é escrito.

**Checklist de deploy:**
1. `pnpm --filter api exec prisma migrate deploy` (as migrations `20260930120000`, `20260930130000` e `20260930140000` são aditivas; a primeira faz backfill dos pedidos de entrega existentes).
2. `pnpm db:seed` (cria `delivery.assign` e liga às funções). Sem o seed, ninguém atribui entregador.
3. Os usuários precisam entrar de novo para receber as permissões novas.
4. Cadastrar usuários com o papel `DELIVERY` e vínculo com a unidade (ainda não há tela de convite; é feito por seed/banco).

**Limites conhecidos:** histórico de até 500 eventos por entrega (aceito: uma entrega gera poucos eventos); eventos anteriores à fatia 3 não trazem `courierUserId`; validação visual em viewport real de 390 px não foi possível neste ambiente (o teste foi por iframe e medição de overflow).
