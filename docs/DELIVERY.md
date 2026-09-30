# Delivery (Fase 10 — primeira fatia)

Estado real implementado em 2026-09-30. Esta fatia cobre **taxa de entrega, configuração por unidade, registro operacional da entrega e o fluxo despachar → entregar**. O que não está aqui está listado em "Limitações".

## Arquitetura

O pedido (`Order`) já guardava `fulfillmentType = DELIVERY` e o **endereço como snapshot** (rua, número, complemento, bairro, cidade, UF, CEP). Isso foi reaproveitado; nada foi duplicado.

Foram adicionados:

| O quê | Onde | Para quê |
|---|---|---|
| `Delivery` (tabela `deliveries`, 1:1 com o pedido) | `schema.prisma` | estado **operacional** da entrega e quem despachou/concluiu |
| `DeliveryStatus` | enum | `PENDING`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED` |
| `Order.deliveryFeeCents` | coluna | snapshot da taxa cobrada; `totalCents = subtotalCents + deliveryFeeCents` |
| `Branch.deliveryEnabled`, `deliveryFeeCents`, `deliveryMinOrderCents` | colunas | configuração de entrega por unidade |
| módulo `delivery` | `apps/api/src/modules/delivery` | listagem, despacho, conclusão e configurações |
| `/dashboard/delivery` | `apps/web` | tela operacional |

### OrderStatus × DeliveryStatus

Os dois são **independentes, mas andam juntos** para pedidos de entrega:

| Pedido (`OrderStatus`) | Entrega (`DeliveryStatus`) |
|---|---|
| `PENDING`, `CONFIRMED`, `PREPARING`, `READY` | `PENDING` |
| `OUT_FOR_DELIVERY` | `OUT_FOR_DELIVERY` |
| `DELIVERED` | `DELIVERED` |
| `CANCELLED` | `CANCELLED` |

- `OrderStatus` continua sendo a linha do tempo comercial (o que o cliente vê na página do pedido). `DeliveryStatus` é o estado operacional, em tabela própria.
- **Escritor único:** para pedidos de entrega, só o `DeliveryService` leva o pedido de `READY` a `OUT_FOR_DELIVERY` e a `DELIVERED`, sempre na **mesma transação** que atualiza a entrega. O endpoint genérico `PATCH /orders/:id/status` continua recusando esses dois status (`INVALID_STATUS_TRANSITION`) e recusa `COMPLETED` para pedido de entrega (`409 DELIVERY_FLOW_REQUIRED`).
- Cancelar o pedido (`PENDING`/`CONFIRMED`/`PREPARING`) cancela a entrega na mesma transação. Nesses status a entrega sempre está `PENDING`.
- Pedidos de retirada (`PICKUP`) e de mesa (`DINE_IN`) **não têm** entrega e seguem o fluxo antigo (`READY → COMPLETED`).

### Transições da entrega

```
PENDING ──dispatch──▶ OUT_FOR_DELIVERY ──complete──▶ DELIVERED
   └──(cancelar o pedido)──▶ CANCELLED
```

- `dispatch` exige entrega `PENDING` **e** pedido `READY` (`409 ORDER_NOT_READY_FOR_DISPATCH` caso contrário).
- `complete` exige entrega `OUT_FOR_DELIVERY`.
- Qualquer outra combinação: `409 INVALID_DELIVERY_TRANSITION`.

## Taxa, pedido mínimo e total (fonte única: servidor)

Calculados em `OrderCreationService.createPricedOrderInTx` por `priceDelivery` (`delivery-pricing.ts`), a partir das configurações da **unidade que recebe o pedido** e do subtotal que o próprio servidor calculou. O cliente não envia nem influencia a taxa (campos extras no corpo são descartados).

- Tudo em **centavos inteiros**. Sem `float`.
- Entrega desabilitada → `400 DELIVERY_UNAVAILABLE` (retirada continua funcionando).
- Soma dos itens menor que o mínimo → `400 DELIVERY_MIN_ORDER_NOT_MET` (`details.minOrderCents`). O mínimo compara só os itens, sem a taxa.
- Total acima de 2.147.483.647 centavos → `400 ORDER_TOTAL_TOO_LARGE`.
- A taxa cobrada fica gravada no pedido (`deliveryFeeCents`): mudar a configuração depois **não altera pedidos existentes**.
- A criação do pedido e da entrega acontece na mesma transação.

Os padrões das colunas novas preservam o comportamento anterior: entrega habilitada, taxa 0, mínimo 0.

## Endpoints (todos exigem autenticação; `tenantId` vem do token)

| Método e rota | Permissão | Descrição |
|---|---|---|
| `GET /v1/delivery?branchId=&status=&page=&pageSize=` | `delivery.read` | lista as entregas da unidade (mais antigas primeiro em `PENDING`/`OUT_FOR_DELIVERY`), com `summary` por status |
| `POST /v1/delivery/:id/dispatch` | `delivery.update` | despacha; idempotente |
| `POST /v1/delivery/:id/complete` | `delivery.update` | confirma a entrega; idempotente |
| `GET /v1/delivery/settings?branchId=` | `delivery.read` | configurações da unidade |
| `PUT /v1/delivery/settings` | `delivery.configure` | substitui `enabled`, `feeCents` (0–1.000.000) e `minOrderCents` (0–100.000.000) |

Também mudaram (campos aditivos): `GET /orders` e `GET /orders/:id` passaram a trazer `deliveryFee` e `delivery { id, status }`; `POST /public/orders` e a página pública do pedido trazem `deliveryFee`; `GET /public/menu/:slug` traz `delivery { enabled, fee, minOrder }` (em reais, só informativo para o checkout).

Nas respostas do módulo `delivery`, valores monetários são **centavos** (`totalCents`, `deliveryFeeCents`, …); nas respostas antigas de pedido continuam em reais, como antes.

## Permissões

| Permissão | OWNER | ADMIN | MANAGER | DELIVERY | demais |
|---|---|---|---|---|---|
| `delivery.read` | ✔ | ✔ | ✔ | ✔ | — |
| `delivery.update` | ✔ | ✔ | ✔ | ✔ | — |
| `delivery.configure` | ✔ | ✔ | ✔ | — | — |

As permissões entram pelo **seed** (`pnpm db:seed`): depois de migrar um banco existente, rode o seed. Sem ele, ninguém tem acesso ao módulo.

## Isolamento e concorrência

- Tenant: sempre filtrado pelo token; entrega/configuração de outro tenant responde 404.
- Unidade: `BranchAccessService` na listagem e nas configurações (403 sem acesso); nas ações por id, entrega de unidade sem acesso responde 404.
- Despachar/concluir travam **primeiro o pedido e depois a entrega** (`SELECT … FOR UPDATE`), a mesma ordem usada ao cancelar o pedido, e leem o estado **depois** do lock. Uma requisição repetida ou simultânea encontra o destino já atingido e responde **200 com `idempotentReplay: true`**, sem escrever nada. Transição impossível responde 409.

## Auditoria

Gravada **dentro da transação** (`AuditService.recordTx`): se a auditoria falhar, a operação inteira sofre rollback.

| Evento | Quando |
|---|---|
| `DELIVERY_DISPATCHED` / `DELIVERY_COMPLETED` (entidade `Delivery`) | ao despachar / concluir; acompanhados de `ORDER_STATUS_CHANGED` (`via: DELIVERY`) |
| `DELIVERY_CANCELLED` (entidade `Order`) | ao cancelar um pedido de entrega |
| `DELIVERY_SETTINGS_UPDATED` (entidade `Branch`) | ao alterar as configurações (antes/depois) |

`ORDER_CREATED` passou a registrar também `deliveryFeeCents`.

## Migration `20260930120000_delivery`

- Cria `DeliveryStatus`, `deliveries` e as colunas novas, com `CHECK` de valores não negativos.
- **Backfill:** todo pedido de entrega já existente ganha sua linha em `deliveries`: pedido `CANCELLED` → `CANCELLED`; `COMPLETED`/`DELIVERED` → `DELIVERED`; `OUT_FOR_DELIVERY` → `OUT_FOR_DELIVERY`; demais → `PENDING`. Horários e responsáveis históricos são **desconhecidos e ficam nulos**. A taxa dos pedidos antigos é 0 (não existia taxa).
- Não apaga nem altera dados existentes.

## Frontend

- `/dashboard/delivery`: abas por status com contagem, tabela (pedido, cliente, endereço, valor e taxa, status do pedido, status da entrega, horário) e ações **Despachar** / **Confirmar entrega**. Atualiza por polling a cada 15 s. Botão "Configurações de entrega" para quem tem `delivery.configure` (ação de gerência). Proteção contra clique duplo no front é complementar; a garantia está no backend.
- Item "Delivery" no menu para OWNER/ADMIN/MANAGER/DELIVERY.
- Checkout público: mostra taxa e pedido mínimo, soma a taxa ao total exibido e desabilita "Entrega" quando a unidade não aceita. O valor real é sempre o do servidor.
- Detalhe do pedido e KDS: pedido de entrega `READY` não oferece "Finalizar" (o back recusa) e aponta para o Delivery.

## Limitações (não implementado nesta fatia)

- Falha de entrega / reentrega (`FAILED`) e cancelamento a partir de `READY`.
- Atribuição de entregador a uma entrega, entregador externo, rastreamento/GPS, mapas, raio ou distância.
- Taxa por bairro/zona ou por distância: há uma taxa única por unidade.
- Observação específica de entrega separada das observações do pedido.
- Notificações (WhatsApp/push) e integração com pagamento online.
- PDV não cria pedidos de entrega (continua marcado como "em breve").
- O checkout público envia o pedido sempre para a unidade mais antiga e ativa do restaurante (comportamento anterior); as configurações lidas são as dessa unidade.
- A listagem do Delivery não tem busca textual nem filtro por data.

## Decisões

- Tabela própria para a entrega (em vez de só usar `OrderStatus`) para manter o operacional separado do comercial e permitir crescer (entregador, falhas) sem mexer no pedido.
- Os status `OUT_FOR_DELIVERY`/`DELIVERED` do pedido, que já existiam reservados no enum e no front, passaram a ser usados, mas só pelo `DeliveryService`.
- `FAILED`/entregador foram deixados de fora de propósito para não decidir, nesta fatia, a política de cancelamento depois de `READY`.
