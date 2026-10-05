# Fidelidade — pontos (Fase 11, fatia 4)

Estado real implementado em 2026-10-04. Programa de pontos por restaurante: o cliente cadastrado ganha pontos nas compras concluídas e troca por recompensas. Não há cashback aqui (ver `docs/CASHBACK.md`), nem expiração de pontos, nem níveis.

## Regra de negócio

1. **Programa por restaurante**, desligado até ser configurado: `enabled` e `pointsPerReal` (inteiro de 1 a 1000, padrão 1).
2. **Ganho (`EARN`)**: um pedido **concluído** (`COMPLETED`, ou `DELIVERED` no delivery) de um **cliente vinculado** credita
   `floor((subtotal − desconto do cupom) / 100) × pointsPerReal` pontos.
   - a base é o que foi pago pelos **itens**; a taxa de entrega não gera pontos;
   - centavos abaixo de R$ 1,00 são desprezados (arredonda para baixo: o programa nunca dá mais que a taxa anunciada);
   - compra que não chega a 1 ponto não gera movimentação;
   - **uma vez por pedido**, garantido por índice único parcial no banco.
3. **Quando**: na mesma transação em que o pedido é concluído. `COMPLETED` e `DELIVERED` são estados finais (não existe cancelamento depois deles), então pontos de compra nunca precisam ser retirados por cancelamento. Pedido cancelado, sem cliente ou com o programa desligado não gera pontos.
4. **Cliente informado depois**: vincular um cliente a um pedido **já concluído** credita os pontos nesse momento (se o programa estiver ligado), uma única vez.
5. **Resgate (`REDEEM`)**: pontos são trocados por uma **recompensa** do catálogo. Quem define quantos pontos saem é a recompensa (lida no servidor dentro da transação); o cliente da API nunca envia quantidade. Exige programa ligado, recompensa ativa e cliente ativo.
6. **Ajuste (`ADJUSTMENT`)**: a gerência credita ou debita pontos manualmente, sempre com motivo.
7. **Estorno (`REVERSAL`)**: desfaz exatamente uma movimentação, uma única vez, com motivo. Um estorno não pode ser estornado (registre um ajuste).
8. **O saldo nunca fica negativo.** Débito maior que o saldo é recusado (`409 LOYALTY_INSUFFICIENT_POINTS`), inclusive o estorno de um crédito cujos pontos já foram gastos.
9. **Pedido que já gerou pontos não troca de cliente** (`409 ORDER_HAS_LOYALTY_POINTS`) enquanto o crédito não for estornado. Depois do estorno a troca é permitida, mas o pedido não gera pontos de novo.

Decisão: a regra de ganho considera o estado do programa **no momento da conclusão** (ou do vínculo). Um pedido concluído com o programa desligado não é creditado retroativamente quando o programa é ligado.

## Modelo (migration `20261005001215_loyalty`, aditiva)

| Tabela | Papel |
|---|---|
| `loyalty_programs` | uma linha por tenant: `enabled`, `pointsPerReal` |
| `loyalty_rewards` | catálogo: `name`, `description`, `pointsCost`, `active` (nunca é excluída, só desativada) |
| `loyalty_accounts` | uma por cliente (`customerId` único), criada no primeiro movimento: `balancePoints` |
| `loyalty_entries` | **o ledger**: `type`, `points` (com sinal), `balanceAfter`, origem (`orderId`, `rewardId`, `branchId`, `reversedEntryId`), `reason`, `idempotencyKey`, `createdByUserId`, `createdAt` |

**O ledger é a fonte de verdade.** `loyalty_accounts.balancePoints` é o total corrente do ledger e só muda na transação que acrescenta uma movimentação, com a linha da conta travada (`SELECT ... FOR UPDATE`) — o mesmo padrão do ledger de estoque (`InventoryBalance` + `StockMovement.balanceAfter`). Cada movimentação guarda o saldo que deixou (`balanceAfter`), então o extrato não precisa ser recalculado.

Garantias que estão **no banco** (além da aplicação):

- `loyalty_entries` é **append-only**: trigger recusa `UPDATE` e `DELETE` (mesma regra de `cash_movements`); um erro se corrige com outra movimentação;
- `CHECK balancePoints >= 0` e `CHECK balanceAfter >= 0`;
- `CHECK points <> 0` e sinal amarrado ao tipo (`EARN` > 0, `REDEEM` < 0);
- `CHECK` de origem por tipo (`EARN` exige pedido, `REDEEM` exige recompensa, `REVERSAL` exige a movimentação estornada);
- `CHECK` de motivo obrigatório (≥ 3 caracteres) em ajuste e estorno;
- índice único parcial `(orderId) WHERE type = 'EARN'`: no máximo um crédito por pedido;
- único em `reversedEntryId`: uma movimentação é estornada no máximo uma vez;
- único em `(tenantId, idempotencyKey)`;
- FKs `RESTRICT` para conta, pedido, recompensa e usuário: o histórico não some.

## Concorrência e idempotência

- **Lock pessimista por conta.** Toda escrita trava a linha da conta; dois resgates simultâneos são processados um de cada vez e o segundo já vê o saldo deixado pelo primeiro. Medido: 20 resgates simultâneos com saldo para 3 → 3 concluídos, 17 recusados com `409`, saldo final correto, nenhum 5xx.
- **Criação da conta** por `INSERT ... ON CONFLICT DO NOTHING`: os primeiros movimentos simultâneos de um cliente não criam duas contas.
- **Ordem de locks:** o que o chamador já segura (linha do pedido, sessão de caixa, cupom) e, por último, a conta de fidelidade. Sempre a mesma ordem, sem ciclo.
- **Idempotência** de resgate, ajuste e estorno por `idempotencyKey` (8 a 100 caracteres, gerada pelo cliente uma vez por tentativa). A chave é conferida de novo **dentro da transação, depois do lock**: uma duplicata que chega enquanto a primeira ainda roda espera o lock e recebe a mesma movimentação (`idempotentReplay: true`), em vez de um falso "saldo insuficiente". Medido: 8 duplicatas simultâneas de um resgate com saldo para um só → as 8 respondem `200` com a mesma movimentação, um único débito. A mesma chave para outra operação, cliente ou valor responde `409 IDEMPOTENCY_KEY_REUSED`.
- **Crédito de compra** é idempotente por pedido (verificação + índice único) e roda sob o lock da linha do pedido que o fluxo de conclusão já segura.

## Atomicidade e auditoria

- O crédito de pontos roda **na transação que conclui o pedido** (`OrderEffectsService.onOrderConcludedInTx`, chamado por `OrdersService`, `DeliveryService` e pelo fechamento de mesa): ou o pedido conclui **e** os pontos existem, ou nada acontece. Testado com falha real injetada: o pedido permanece `READY`.
- Toda movimentação grava auditoria **na mesma transação** (`AuditService.recordTx`): `LOYALTY_POINTS_EARNED`, `LOYALTY_POINTS_REDEEMED`, `LOYALTY_POINTS_ADJUSTED`, `LOYALTY_ENTRY_REVERSED`; configuração: `LOYALTY_PROGRAM_UPDATED`, `LOYALTY_REWARD_CREATED`, `LOYALTY_REWARD_UPDATED`. A trilha guarda ids e quantidades, nunca nome ou telefone do cliente.

## Endpoints (todos autenticados, `tenantId` sempre do token)

| Método e rota | Permissão | Descrição |
|---|---|---|
| `GET /v1/loyalty/program` | `loyalty.read` | configuração do programa |
| `PUT /v1/loyalty/program` | `loyalty.configure` | liga/desliga e define `pointsPerReal` |
| `GET /v1/loyalty/rewards?status=active\|inactive\|all` | `loyalty.read` | catálogo, do mais barato ao mais caro |
| `POST /v1/loyalty/rewards` | `loyalty.configure` | cria recompensa |
| `PATCH /v1/loyalty/rewards/:id` | `loyalty.configure` | edita, desativa (`active=false`) ou reativa |
| `GET /v1/loyalty/customers/:customerId` | `loyalty.read` | saldo e estado do programa |
| `GET /v1/loyalty/customers/:customerId/entries?page=&pageSize=` | `loyalty.read` | extrato, mais recente primeiro |
| `POST /v1/loyalty/customers/:customerId/redeem` | `loyalty.redeem` | `{ rewardId, branchId, idempotencyKey }` |
| `POST /v1/loyalty/customers/:customerId/adjust` | `loyalty.adjust` | `{ points (≠ 0, ±1.000.000), reason, idempotencyKey }` |
| `POST /v1/loyalty/entries/:id/reverse` | `loyalty.adjust` | `{ reason, idempotencyKey }` |

Cliente ou recompensa de outro restaurante respondem `404`.

## Permissões e isolamento

| Permissão | OWNER | ADMIN | MANAGER | CASHIER | demais |
|---|---|---|---|---|---|
| `loyalty.read` | ✔ | ✔ | ✔ | ✔ | — |
| `loyalty.redeem` | ✔ | ✔ | ✔ | ✔ | — |
| `loyalty.adjust` (ajuste e estorno) | ✔ | ✔ | ✔ | — | — |
| `loyalty.configure` (programa e recompensas) | ✔ | ✔ | — | — | — |

As permissões entram pelo **seed** (`pnpm db:seed`) e os usuários precisam entrar de novo.

- **Tenant:** programa, recompensas, contas e movimentações são do tenant do token; cada restaurante tem o seu programa.
- **Filial:** a conta de pontos é do cliente no restaurante inteiro (ele compra em qualquer unidade). O resgate registra a unidade onde aconteceu e exige acesso a ela (`403 BRANCH_ACCESS_DENIED`).

## Frontend

- `/dashboard/fidelidade` (menu "Fidelidade"): programa (liga/desliga, pontos por real) e catálogo de recompensas. Gerente e caixa veem; só proprietário e administrador alteram.
- Detalhe do cliente → aba **Fidelidade**: saldo, resgate de recompensa, ajuste manual (gerência) e extrato com estorno.
- Operações com chave de idempotência reutilizada em retentativas e trava contra duplo clique.

## Limitações

- Pontos **não expiram** e não há níveis/categorias de cliente.
- O resgate é registrado no cadastro do cliente (a recompensa é entregue pelo atendente); ele **não** entra como desconto em um pedido.
- A taxa é única por restaurante (sem regra por produto, dia ou filial).
- Mudar a taxa vale para pedidos concluídos dali em diante; nada é recalculado.
- O checkout público não identifica cliente: pedido online só gera pontos depois de um funcionário vinculá-lo.

## Deploy

1. `pnpm --filter api exec prisma migrate deploy` (migration `20261005001215_loyalty`: 4 tabelas e 1 enum novos; nenhuma tabela existente é alterada).
2. `pnpm db:seed` (permissões `loyalty.*`) e novo login dos usuários.
3. O programa nasce desligado: nada muda para o restaurante até alguém ativá-lo.
