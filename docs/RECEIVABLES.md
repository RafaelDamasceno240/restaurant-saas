# Fiado / contas a receber (Fase 11, fatia 6)

Estado real implementado em 2026-10-05. **Domínio financeiro:** fiado é dinheiro que o cliente deve ao restaurante, em centavos inteiros. Uma venda "na conta" abre uma dívida com parcelas e vencimentos; os recebimentos abatem a dívida; tudo fica em um ledger.

## Regra de negócio

1. **Limite por cliente** (`creditLimitCents`), `0` por padrão: sem limite o cliente **não compra fiado**. Quem define é a gestão.
2. **Vender fiado** (pedido com forma de pagamento `ON_ACCOUNT`, no PDV e no fechamento de mesa) exige, conferido contra a conta **travada** dentro da transação que cria o pedido:
   - cliente cadastrado e ativo (`400 RECEIVABLE_CUSTOMER_REQUIRED` sem cliente);
   - limite maior que zero (`409 RECEIVABLE_CREDIT_NOT_ALLOWED`);
   - **nenhuma parcela vencida** (`409 RECEIVABLE_CUSTOMER_OVERDUE`);
   - dívida atual + total da venda ≤ limite (`409 RECEIVABLE_LIMIT_EXCEEDED`, com limite, dívida e valor pedido em `details`);
   - valor a lançar ≥ R$ 0,01 (`400 RECEIVABLE_NOTHING_TO_CHARGE`, por exemplo venda toda paga com cashback).
3. **O que vai para a conta** é o total do pedido (`subtotal − cupom − cashback usado + taxa`). Nada entra no caixa e nenhum `Payment` é criado: nada foi recebido.
4. **Parcelas:** de 1 a 12, mensais a partir do primeiro vencimento (mesmo dia nos meses seguintes, ajustado ao último dia do mês). Partes iguais; os centavos que sobram vão um em cada parcela, das primeiras para as últimas (R$ 200,00 em 3x = 66,67 + 66,67 + 66,66). Primeiro vencimento de hoje até 365 dias à frente. Sem condições informadas: 1 parcela para daqui a 30 dias.
5. **Recebimento (`PAYMENT`)**: total ou parcial, em dinheiro, Pix ou cartão (nunca "fiado"). Abate as parcelas pela ordem de vencimento, ou só a parcela escolhida. Nunca mais do que está em aberto (`409 RECEIVABLE_OVERPAYMENT`). Dinheiro exige caixa aberto na unidade e gera o movimento `RECEIVABLE_PAYMENT` na sessão.
6. **Estorno de recebimento (`REVERSAL`)**: uma única vez, com motivo. As parcelas e a conta voltam exatamente ao que eram. Estorno de dinheiro tira o valor do caixa aberto da unidade informada (movimento `RECEIVABLE_REFUND`).
7. **Cancelamento da conta**: só sem nenhum recebimento (`409 RECEIVABLE_HAS_PAYMENTS`; estorne antes), com motivo. É também o caminho para perdoar uma dívida: fica auditado quem cancelou e por quê.
8. **Cancelar o pedido cancela a dívida dele** na mesma transação. Se a dívida já recebeu pagamento, o cancelamento do pedido é recusado.
9. **Pedido vendido fiado não troca de cliente** (`409 ORDER_HAS_RECEIVABLE`) enquanto a dívida existir.
10. **Venda fiado não gera pontos nem cashback** (o cliente ainda não pagou). Decisão registrada; não há crédito retroativo quando a dívida é quitada.
11. **Dívida avulsa** (`POST /v1/receivables`): para o saldo do caderno ou um acordo. Só a gestão lança; **não** é conferida contra o limite (o limite governa o que o balcão pode vender).
12. **Atraso não é um estado gravado.** Uma parcela está vencida quando ainda deve algo e o vencimento é anterior a **hoje no fuso do restaurante** (`tenants.timezone`, padrão `America/Sao_Paulo`). Vence no dia X = vencida a partir de X+1.
13. **O checkout público nunca vende fiado**: o DTO público só aceita `CASH`, `PIX` e `CARD`.

Baixar o limite abaixo da dívida atual é permitido: só bloqueia novas vendas.

## Modelo (migration `20261005005645_receivables`)

| Tabela | Papel |
|---|---|
| `credit_accounts` | uma por cliente (`customerId` único): `creditLimitCents`, `balanceCents` (a dívida em aberto) |
| `receivables` | a conta: cliente, unidade, pedido (`orderId` único, nulo na dívida avulsa), `totalCents`, `paidCents`, `status` (`OPEN`/`PAID`/`CANCELLED`), motivo do cancelamento |
| `receivable_installments` | parcelas: `number`, `dueDate` (tipo `DATE`), `amountCents`, `paidCents` |
| `receivable_entries` | **o ledger**: `type` (`CHARGE`/`PAYMENT`/`REVERSAL`), `amountCents` com sinal (do ponto de vista da dívida), `balanceAfterCents`, forma de pagamento, unidade, `cashMovementId`, `reversedEntryId`, `reason`, `idempotencyKey`, `createdByUserId` |
| `receivable_payment_allocations` | quanto de cada pagamento abateu cada parcela (é o que o estorno desfaz) |
| `tenants.timezone` | coluna nova, `NOT NULL DEFAULT 'America/Sao_Paulo'` |

Enums ampliados: `PaymentMethod` ganhou `ON_ACCOUNT`; `CashMovementType` ganhou `RECEIVABLE_PAYMENT` e `RECEIVABLE_REFUND`.

**O ledger é a fonte de verdade.** `credit_accounts.balanceCents`, `receivables.paidCents` e `receivable_installments.paidCents` são totais correntes que só mudam na transação que acrescenta uma movimentação, com a linha da conta de crédito travada (`SELECT ... FOR UPDATE`).

Garantias no **banco**:

- `receivable_entries` e `receivable_payment_allocations` **append-only** (trigger recusa `UPDATE` e `DELETE`);
- limite e dívida nunca negativos; `balanceAfterCents >= 0`;
- `0 <= paidCents <= totalCents` na conta e em cada parcela;
- o status diz a verdade: `PAID` só com tudo pago, `OPEN` só com algo em aberto, `CANCELLED` só sem pagamento e com motivo;
- sinal por tipo (`CHARGE` > 0, `PAYMENT` < 0);
- forma de pagamento obrigatória e real (`CASH`/`PIX`/`CARD`) em `PAYMENT`, proibida nos outros tipos;
- `REVERSAL` exige a movimentação estornada e motivo;
- únicos: `orderId` da conta, `reversedEntryId`, `cashMovementId`, `(tenantId, idempotencyKey)`.

## Concorrência, idempotência e reprocessamento

- **Lock pessimista por conta de crédito**, com a mesma ordem em todos os fluxos de pedido: linha do pedido → sessão de caixa → cupom → conta de cashback → **conta de crédito** → conta de fidelidade → saldos de estoque. No recebimento em dinheiro: sessão de caixa → conta de crédito.
- **Venda em duas etapas na mesma transação:** `reserveSaleInTx` trava a conta e confere limite e atraso antes de o pedido existir; `commitSaleInTx` abre a conta apontando para o pedido recém-criado. Qualquer falha desfaz tudo.
- Medido nos testes: 10 vendas simultâneas de R$ 40,00 contra limite de R$ 100,00 → 2 criadas, 8 recusadas com `409`, dívida final R$ 80,00; 20 recebimentos simultâneos de R$ 1,00 contra R$ 3,50 em aberto → 3 aceitos, 17 recusados, nunca pago a mais; 6 estornos simultâneos do mesmo pagamento → 1 aceito.
- **Idempotência da venda** é a do pedido (`idempotencyKey` do PDV e da mesa): repetir devolve o mesmo pedido e a mesma dívida, mesmo sem limite sobrando; a mesma chave com outra forma de pagamento, outra quantidade de parcelas ou outro primeiro vencimento é `409 IDEMPOTENCY_KEY_REUSED` (condições omitidas na repetição só valem para a venda feita no padrão de 1 parcela).
- **Recebimento, estorno e dívida avulsa** têm chave própria, reconferida dentro da transação depois do lock; a repetição devolve o mesmo resultado (`idempotentReplay: true`), e a mesma chave com outros dados é `409`.
- Cancelar a conta duas vezes não grava nada na segunda.

## Atomicidade e auditoria

Cada operação grava auditoria na mesma transação: `RECEIVABLE_LIMIT_UPDATED`, `RECEIVABLE_CREATED`, `RECEIVABLE_PAYMENT_RECORDED`, `RECEIVABLE_PAYMENT_REVERSED`, `RECEIVABLE_CANCELLED`. Testado com falha real injetada: sem auditoria, não há dívida, nem pedido, nem movimento de caixa; se o cancelamento da dívida não pode ser registrado, o pedido **não** é cancelado.

## Endpoints (todos autenticados, `tenantId` sempre do token)

| Método e rota | Permissão | Descrição |
|---|---|---|
| `GET /v1/receivables` | `receivables.read` | lista paginada; `status` = `open` (padrão), `overdue`, `paid`, `cancelled`, `all`; `customerId`, `branchId`, `search`; devolve `summary` e `today` |
| `GET /v1/receivables/:id` | `receivables.read` | conta, parcelas e histórico |
| `GET /v1/receivables/customers/:customerId` | `receivables.read` | limite, dívida, disponível, vencido, `canBuyOnAccount` |
| `PUT /v1/receivables/customers/:customerId/limit` | `receivables.manage` | `{ creditLimitCents }` (0 = sem fiado) |
| `POST /v1/receivables` | `receivables.manage` | dívida avulsa: `{ customerId, branchId, description, totalCents, installments, firstDueDate, idempotencyKey }` |
| `POST /v1/receivables/:id/payments` | `receivables.receive` | `{ amountCents, method, branchId, installmentId?, idempotencyKey }` |
| `POST /v1/receivables/entries/:entryId/reverse` | `receivables.manage` | `{ reason, branchId?, idempotencyKey }` (`branchId` obrigatório para dinheiro) |
| `POST /v1/receivables/:id/cancel` | `receivables.manage` | `{ reason }` |
| `POST /v1/pos/orders` | `pos.create` + `receivables.sell` | `paymentMethod: "ON_ACCOUNT"` + `creditTerms?: { installments, firstDueDate }` (exige `customerId`) |
| `POST /v1/tabs/:id/checkout` | `tabs.close` + `receivables.sell` | idem |

O detalhe da sessão de caixa ganhou `totals.receivablePaymentsCents` e `totals.receivableRefundsCents`; saldo esperado = abertura + suprimentos + vendas + fiado recebido − sangrias − estornos de fiado. O endpoint manual de movimentos continua aceitando só suprimento e sangria.

## Permissões e isolamento

| Permissão | OWNER | ADMIN | MANAGER | CASHIER | demais |
|---|---|---|---|---|---|
| `receivables.read` | ✔ | ✔ | ✔ | ✔ | — |
| `receivables.sell` (vender fiado) | ✔ | ✔ | ✔ | ✔ | — |
| `receivables.receive` (registrar recebimento) | ✔ | ✔ | ✔ | ✔ | — |
| `receivables.manage` (limite, dívida avulsa, estorno, cancelamento) | ✔ | ✔ | ✔ | — | — |

Entram pelo **seed**; os usuários precisam entrar de novo. Garçom fecha conta de mesa, mas não lança no fiado.

- **Tenant:** tudo é escopado pelo tenant do token; cliente, conta ou movimentação de outro restaurante respondem `404`.
- **Unidade:** quem não é proprietário/administrador só vê e opera contas das unidades a que está vinculado (lista, totais, detalhe, recebimento); filtrar por outra unidade é `403`. O limite e a dívida são do **cliente**, somando todas as unidades.

## Frontend

- **Menu "Fiado"** → `/dashboard/fiado` ("Contas a receber"): totais (em aberto, vencido, clientes devendo), abas por situação, busca, e o detalhe da conta com parcelas, recebimento, histórico, estorno e cancelamento. Botão "Lançar dívida" para a gestão. Aceita `?conta=<id>` e `?cliente=<id>`.
- **PDV e fechamento de mesa:** forma de pagamento **Fiado** (só para quem pode vender fiado). Com o cliente escolhido aparece o quadro com o limite disponível, parcelas e primeiro vencimento. A tela só envia as condições; limite e atraso são decididos pelo servidor.
- **Cliente → aba Fiado:** limite, dívida, disponível, vencido, edição do limite e as contas do cliente.
- **Caixa:** cartão "Fiado recebido" e os movimentos "Recebimento de fiado" e "Estorno de fiado".
- Pedidos mostram "Fiado" como forma de pagamento.

## Limitações

- Sem juros, multa ou correção por atraso.
- Sem renegociação de parcelas depois de lançadas (cancele sem pagamentos e lance de novo, ou receba parcial).
- Sem cobrança automática nem lembrete (WhatsApp e afins estão fora deste bloco).
- Sem baixa por perda separada do cancelamento: perdoar uma dívida com pagamentos exige estornar os pagamentos antes.
- O fuso é uma coluna do tenant com valor padrão; ainda não há tela para alterá-lo.
- Um pagamento abate uma conta por vez (não há "pagar tudo que o cliente deve" em um único lançamento).
- Venda fiado só nos fluxos internos (PDV e mesa); delivery e cardápio público não oferecem.
- Pedido concluído não pode ser cancelado (estado final), então a dívida dele só sai por recebimento ou cancelamento da conta.
- Os totais de "vencido" da lista somam as parcelas vencidas em memória: o custo cresce com a quantidade de parcelas vencidas em aberto (não com a página). Suficiente para um restaurante; vira agregação em SQL se o volume pedir.

## Deploy

1. `pnpm --filter api exec prisma migrate deploy` (migration `20261005005645_receivables`). Cria 5 tabelas e 2 enums, adiciona `tenants.timezone` com valor padrão e **acrescenta valores** aos enums `PaymentMethod` e `CashMovementType`. Não reescreve dados existentes. Verificado em banco novo (16 migrations, sem diferença para o schema) e em uma cópia do DEV (13 → 16 migrations; 656 pedidos, soma dos totais, 204 movimentos de caixa e 130 pagamentos inalterados).
2. `pnpm db:seed` (permissões `receivables.*`) e novo login.
3. Nenhum cliente nasce com limite: o fiado só começa a ser usado quando a gestão define o primeiro.

**Não aplicada no banco DEV.**
