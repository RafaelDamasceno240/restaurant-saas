# Cashback (Fase 11, fatia 5)

Estado real implementado em 2026-10-04. **Domínio financeiro:** cashback é dinheiro que o restaurante deve ao cliente, em centavos inteiros. Parte do valor de uma compra concluída volta como saldo, e o saldo paga itens de compras futuras.

## Regra de negócio

1. **Programa por restaurante**, desligado até ser configurado:
   - `enabled`;
   - `earnRateBps`: percentual em **pontos-base** (500 = 5,00%), inteiro de 1 a 5000 (0,01% a 50%);
   - `expireAfterDays`: dias sem crédito nem uso até o saldo expirar; `null` = não expira.
2. **Ganho (`EARN`)**: um pedido **concluído** (`COMPLETED` ou `DELIVERED`) de um cliente vinculado credita
   `floor((subtotal − desconto do cupom − cashback usado) × earnRateBps / 10000)` centavos.
   - a base é o que foi pago **com dinheiro pelos itens**: a taxa de entrega não gera saldo, e a parte do pedido paga com cashback também não (senão saldo geraria saldo);
   - arredonda para baixo ao centavo; compra que não chega a 1 centavo não gera movimentação;
   - **uma vez por pedido** (índice único parcial).
3. **Uso (`USE`)**: o saldo paga os **itens** de um pedido do mesmo cliente, no PDV e no fechamento de mesa.
   - o atendente informa quanto usar (`cashbackToUseCents`); o servidor confere contra o **saldo travado** e contra o valor dos itens depois do cupom, **dentro da transação que cria o pedido**;
   - pedir mais que o saldo recusa o pedido inteiro (`409 CASHBACK_INSUFFICIENT_BALANCE`); pedir mais que os itens custam é `400 CASHBACK_EXCEEDS_ORDER`; sem cliente vinculado é `400 CASHBACK_CUSTOMER_REQUIRED`; programa desligado é `409 CASHBACK_DISABLED`;
   - cashback **não paga taxa de entrega** e nunca deixa o total negativo;
   - uma vez por pedido; o checkout público nunca usa cashback (não identifica cliente).
4. **Total do pedido:** `total = subtotal − desconto − cashback usado + taxa de entrega`. A coluna `orders.cashbackUsedCents` guarda o valor usado e o banco confere a fórmula (`CHECK`). O que entra no caixa e no pagamento é o total já líquido.
5. **Cancelamento:** cancelar um pedido que usou cashback **devolve o valor ao cliente** (`REVERSAL` do `USE`, motivo "Pedido cancelado"), na mesma transação do cancelamento. Um uso não pode ser estornado manualmente: ele só volta quando o pedido é cancelado.
6. **Ajuste administrativo (`ADJUSTMENT`)**: crédito ou débito manual, com motivo, até R$ 100.000,00 por lançamento.
7. **Estorno (`REVERSAL`)**: desfaz um crédito de compra ou um ajuste, uma única vez, com motivo. Recusado se deixaria o saldo negativo.
8. **Expiração (`EXPIRATION`)**: com `expireAfterDays` definido, o saldo inteiro expira depois desse número de dias sem **crédito nem uso**.
   - o saldo expirado deixa de estar disponível **na hora** (o saldo consultado já vem zerado, com `expiredPendingCents`);
   - a baixa no ledger é feita pela próxima operação que tocar a conta (toda escrita liquida a expiração antes) ou pelo botão/rota de baixa em lote; **não há agendador** nesta versão;
   - expirações não podem ser estornadas (registre um ajuste).
9. **O saldo nunca fica negativo.**
10. **Pedido que movimentou cashback não troca de cliente** (`409 ORDER_HAS_CASHBACK`) enquanto o uso não for devolvido (cancelamento) ou o crédito não for estornado.

Decisões: vale o estado do programa no momento da operação (sem crédito retroativo); o pedido cancelado mantém registrado quanto havia usado (`cashbackUsedCents` não é zerado: o extrato mostra o uso e a devolução).

## Modelo (migration `20261005003323_cashback`)

| Tabela | Papel |
|---|---|
| `cashback_programs` | uma linha por tenant: `enabled`, `earnRateBps`, `expireAfterDays` |
| `cashback_accounts` | uma por cliente (`customerId` único): `balanceCents`, `lastActivityAt` |
| `cashback_entries` | **o ledger**: `type`, `amountCents` (com sinal), `balanceAfterCents`, `orderId`, `branchId`, `reversedEntryId`, `reason`, `idempotencyKey`, `createdByUserId`, `createdAt` |
| `orders.cashbackUsedCents` | coluna nova, `NOT NULL DEFAULT 0` |

**O ledger é a fonte de verdade.** `cashback_accounts.balanceCents` é o total corrente e só muda na transação que acrescenta uma movimentação, com a linha da conta travada (`SELECT ... FOR UPDATE`). Nunca existe `balance += valor` solto.

Cada movimentação tem: valor (`amountCents`), tipo, origem e referência (`orderId` / `reversedEntryId` / `reason`), data, responsável (`createdByUserId`; `NULL` quando o sistema baixou uma expiração ao tocar a conta) e chave de idempotência quando a operação parte de um clique.

Garantias no **banco**:

- `cashback_entries` **append-only** (trigger recusa `UPDATE` e `DELETE`);
- `CHECK balanceCents >= 0` e `CHECK balanceAfterCents >= 0`;
- `CHECK amountCents <> 0` e sinal por tipo (`EARN` > 0; `USE` e `EXPIRATION` < 0);
- `CHECK` de origem por tipo (`EARN`/`USE` exigem pedido; `REVERSAL` exige a movimentação estornada);
- motivo obrigatório em ajuste e estorno;
- índices únicos parciais: um `EARN` por pedido e um `USE` por pedido;
- únicos em `reversedEntryId` e em `(tenantId, idempotencyKey)`;
- em `orders`: `orders_total_formula` (recriado com o cashback) e `orders_cashback_range` (`0 <= cashbackUsedCents <= subtotalCents - discountCents`).

## Concorrência, idempotência e reprocessamento

- **Lock pessimista por conta**, com a mesma ordem em todos os fluxos de pedido: sessão de caixa → cupom → **conta de cashback** → conta de fidelidade. A conta de cashback sempre vem antes da de fidelidade, então dois pedidos do mesmo cliente nunca esperam um pelo outro em ciclo. Medido: 10 vendas simultâneas usando R$ 3,00 de um saldo de R$ 10,00 → 3 criadas, 7 recusadas com `409`, saldo final R$ 1,00, nenhum 5xx; 20 débitos simultâneos com saldo para 3 → 3 concluídos.
- **Uso em duas etapas na mesma transação:** `reserveUseInTx` trava a conta e valida o valor antes de o pedido existir; `commitUseInTx` grava o `USE` apontando para o pedido recém-criado. Qualquer falha desfaz tudo.
- **Idempotência do uso** é a do pedido: repetir a venda com a mesma `idempotencyKey` devolve o mesmo pedido e não debita de novo; a comparação da repetição inclui o valor de cashback (mesma chave com outro valor = `409 IDEMPOTENCY_KEY_REUSED`). Duplicatas **simultâneas** de uma venda que consome o saldo todo recebem todas o mesmo pedido (a que perde a corrida pelo saldo é reconhecida como repetição, não como "saldo insuficiente").
- **Crédito de compra e devolução no cancelamento** são idempotentes por pedido (verificação + índices únicos) e rodam sob o lock da linha do pedido.
- **Ajuste e estorno** são idempotentes por chave, reconferida dentro da transação depois do lock.

## Atomicidade e auditoria

Toda movimentação grava auditoria na mesma transação: `CASHBACK_EARNED`, `CASHBACK_USED`, `CASHBACK_USE_REFUNDED`, `CASHBACK_ADJUSTED`, `CASHBACK_ENTRY_REVERSED`, `CASHBACK_EXPIRED`, `CASHBACK_PROGRAM_UPDATED`. Testado com falha real injetada: se a devolução não pode ser registrada, o pedido **não** é cancelado; se o ajuste não pode ser auditado, nada é gravado.

## Endpoints (todos autenticados, `tenantId` sempre do token)

| Método e rota | Permissão | Descrição |
|---|---|---|
| `GET /v1/cashback/program` | `cashback.read` | configuração |
| `PUT /v1/cashback/program` | `cashback.configure` | `{ enabled, earnRateBps, expireAfterDays \| null }` |
| `POST /v1/cashback/expire` | `cashback.configure` | baixa no ledger os saldos já expirados (lote de até 200 contas) |
| `GET /v1/cashback/customers/:customerId` | `cashback.read` | `balanceCents` disponível, `expiredPendingCents`, `expiresAt`, programa |
| `GET /v1/cashback/customers/:customerId/entries` | `cashback.read` | extrato |
| `POST /v1/cashback/customers/:customerId/adjust` | `cashback.adjust` | `{ amountCents (≠ 0), reason, idempotencyKey }` |
| `POST /v1/cashback/entries/:id/reverse` | `cashback.adjust` | `{ reason, idempotencyKey }` (crédito de compra ou ajuste) |
| `POST /v1/pos/orders` | `pos.create` + `cashback.use` | aceita `cashbackToUseCents` (exige `customerId`) |
| `POST /v1/tabs/:id/checkout` | `tabs.close` + `cashback.use` | aceita `cashbackToUseCents` (exige `customerId`) |

As respostas autenticadas de pedido ganharam `cashbackUsed` (em reais, como `discount`).

## Permissões e isolamento

| Permissão | OWNER | ADMIN | MANAGER | CASHIER | demais |
|---|---|---|---|---|---|
| `cashback.read` | ✔ | ✔ | ✔ | ✔ | — |
| `cashback.use` (usar numa venda) | ✔ | ✔ | ✔ | ✔ | — |
| `cashback.adjust` (ajuste e estorno) | ✔ | ✔ | ✔ | — | — |
| `cashback.configure` (programa e baixa de expirados) | ✔ | ✔ | — | — | — |

Entram pelo **seed**; os usuários precisam entrar de novo. Tudo é escopado pelo tenant do token: cliente, conta ou movimentação de outro restaurante respondem `404`, e a baixa em lote de um restaurante nunca toca outro.

## Frontend

- `/dashboard/fidelidade` ("Fidelidade e cashback"): cartão de configuração do cashback (percentual, expiração, baixa de expirados).
- PDV e fechamento de mesa: com um cliente selecionado e saldo disponível aparece o campo **Cashback do cliente** (valor a usar e botão "Usar R$ X"). A tela só envia o valor; o total exibido é conveniência.
- Detalhe do cliente → aba **Cashback**: saldo disponível, data de expiração, ajuste administrativo e extrato com estorno.
- Detalhe do pedido: linha "Cashback usado".

## Limitações

- Expiração é por **inatividade da conta inteira**, não por lote de crédito (não há "vence primeiro o mais antigo").
- Sem agendador: a baixa de expirados no ledger acontece ao tocar a conta ou pelo botão; o saldo expirado já não é utilizável antes disso.
- Cashback não é usado no checkout público, nem paga taxa de entrega.
- Percentual único por restaurante (sem regra por produto, dia ou filial).
- Sem conversão em dinheiro/saque: o saldo só vira desconto em compra.
- Um uso é desfeito apenas cancelando o pedido; pedidos concluídos não podem ser cancelados (estado final).

## Deploy

1. `pnpm --filter api exec prisma migrate deploy` (migration `20261005003323_cashback`). Ela cria 3 tabelas e 1 enum, adiciona `orders.cashbackUsedCents` e **recria** o `CHECK orders_total_formula`, o que revalida as linhas de `orders` sob lock curto. As linhas existentes satisfazem a nova fórmula por construção (a anterior já era um `CHECK` e a coluna nova nasce 0). Verificado em uma cópia do banco DEV: 13 → 15 migrations, 656 pedidos e soma dos totais inalterados.
2. `pnpm db:seed` (permissões `cashback.*`) e novo login.
3. O programa nasce desligado.
