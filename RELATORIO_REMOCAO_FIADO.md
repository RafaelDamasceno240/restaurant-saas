# Relatório — Remoção do fiado

Data: 12/11/2026
Branch: `remocao-fiado` (worktree `restaurant-saas-fiado`, criada a partir de
`salto-desenvolvimento` em `c866ff5`). Commit apenas local: **sem push, sem deploy, sem
integração**. Independente da branch `assistente-whatsapp` e da `adicionais-pdv-comandas`.

## 1. Decisão e resultado

Decisão do proprietário: o Restaurant SaaS não oferece mais vendas fiadas. Toda venda nova é paga
na hora — **dinheiro, PIX ou cartão**.

Resultado:
- **Nenhuma venda nova pode ser fiada**, por nenhum caminho: PDV, fechamento de comanda,
  checkout público e requisições diretas à API (a regra está no serviço que cria todo pedido, além
  da validação das telas).
- **Nenhum crédito novo**: não existe mais limite de fiado nem lançamento manual de dívida.
- **O histórico ficou intacto**: vendas fiadas antigas, contas a receber, parcelas, pagamentos,
  estornos, movimentos de caixa e auditoria continuam no banco e nas telas, e os valores em aberto
  podem ser **consultados, recebidos, estornados e cancelados**.
- **Sem migration**: nenhuma tabela, coluna ou valor de enum foi apagado ou alterado.

## 2. Inventário de dependências (feito antes de alterar)

| Área | Onde o fiado aparecia | O que foi feito |
|---|---|---|
| PDV (API) | `PaymentMethod.ON_ACCOUNT`, `creditTerms`, permissão `receivables.sell` | Só `CASH`/`PIX`/`CARD` aceitos; `creditTerms` não existe mais; verificação da permissão removida |
| Comandas (API) | Fechamento com `ON_ACCOUNT` sem pagamento registrado | Só `CASH`/`PIX`/`CARD`; todo fechamento grava o pagamento |
| Criação de pedido | Reserva de crédito (limite, vencidos) e abertura do recebível na mesma transação | Removida; `OrderCreationService` recusa `ON_ACCOUNT` (código `ON_ACCOUNT_DISABLED`) em `createOrder` e `createPricedOrderInTx` |
| Checkout público | Já recusava fiado | Passa a usar a mesma lista única de formas de pagamento |
| Contas a receber (API) | `POST /receivables` (dívida avulsa), `PUT /receivables/customers/:id/limit` | **Rotas removidas** (404) |
| Contas a receber (API) | Listar, detalhar, conta do cliente, receber, estornar, cancelar | **Mantidas** (regularização do histórico) |
| Cancelamento de pedido | Cancela a dívida do pedido fiado; recusa se houver pagamentos | **Mantido** (para as vendas antigas) |
| Troca de cliente do pedido | Recusada enquanto houver dívida | **Mantida** |
| Caixa | Recebimento/estorno de fiado em dinheiro entram/saem da sessão | **Mantido** |
| Relatórios | Vendas por forma de pagamento (inclui `ON_ACCOUNT`), fiado recebido | **Mantidos** (totais históricos) |
| Fidelidade e cashback | Venda fiada não gera pontos nem cashback | **Mantido** (vale para o histórico) |
| RBAC | `receivables.read`, `.sell`, `.receive`, `.manage` | `receivables.sell` (exclusiva de vender fiado) removida; as outras três seguem necessárias |
| Web — PDV | Botão "Fiado", parcelas, limite | Removidos |
| Web — Mesas | Opção "Fiado", parcelas, "Lançar no fiado" | Removidos |
| Web — Contas a receber | "Lançar dívida" | Removido; aviso de que não há fiado novo; menu renomeado "Contas a receber" |
| Web — Cliente | Aba "Fiado" com limite | Vira "Fiado antigo": só saldo, vencido e contas, sem limite |
| Banco | `credit_accounts.creditLimitCents`, enum `ON_ACCOUNT`, tabelas `receivable*` | **Nada alterado** |
| Assistente de WhatsApp | Usa o checkout público | O checkout já recusava fiado; na branch `assistente-whatsapp` foi acrescentada uma regra para nunca oferecer fiado (seção 7) |

## 3. Funcionalidades removidas

1. Opção "Fiado" no PDV e no fechamento de comanda (telas e API).
2. Condições de pagamento a prazo (`creditTerms`: parcelas e primeiro vencimento) nas vendas.
3. Limite de fiado por cliente (tela e `PUT /v1/receivables/customers/:id/limit`).
4. Lançamento manual de dívida ("Lançar dívida", `POST /v1/receivables`).
5. Permissão `receivables.sell`.
6. Código que só servia para criar dívida: reserva de crédito, cálculo do plano de parcelas,
   validação de condições, erros de limite/vencido/sem cliente, componentes `CreditTermsField` e
   `NewChargeDialog`.

## 4. Como o histórico foi preservado

- **Nenhuma linha é apagada ou alterada** pela mudança: não há migration nem script de dados.
- O valor `ON_ACCOUNT` continua no enum: descreve as vendas antigas, que aparecem no histórico de
  pedidos, nos relatórios (vendas por forma de pagamento) e no detalhe do pedido como fiado.
- As tabelas `credit_accounts`, `receivables`, `receivable_installments`, `receivable_entries` e
  `receivable_payment_allocations` continuam com seus gatilhos de imutabilidade (lançamentos não
  podem ser editados nem apagados).
- O que existe em aberto pode ser **regularizado**: receber (total ou parcial, dinheiro entra no
  caixa), estornar um recebimento, cancelar uma conta sem pagamentos, e cancelar o pedido antigo
  (a dívida é cancelada junto, na mesma transação). Tudo continua auditado.
- A coluna `creditLimitCents` fica no banco, mas não é mais lida nem escrita.

## 5. Arquivos alterados

**API**
- `src/common/util/payment-methods.ts` (novo): lista única `SALE_PAYMENT_METHODS` e o erro `ON_ACCOUNT_DISABLED`.
- `src/modules/order-creation/order-creation.service.ts` e `.module.ts`: recusa do fiado; sem dependência de recebíveis.
- `src/modules/pos/dto/create-pos-order.dto.ts`, `pos-orders.service.ts`, `pos-orders.service.spec.ts`.
- `src/modules/tabs/dto/checkout-tab.dto.ts`, `tabs.service.ts`.
- `src/modules/public-orders/dto/create-order.dto.ts`.
- `src/modules/receivables/`: `receivables.controller.ts`, `receivables.service.ts`, `dto/receivables.dto.ts`,
  `receivable-calculations.ts` (+ spec), `receivable-errors.ts`.
- `src/common/validation/validation-messages.ts` (rótulo de `creditTerms` removido).
- `prisma/seed.ts` (`receivables.sell` removida).

**Testes E2E**
- `test/fiado-disabled.e2e-spec.ts` (novo) e `test/legacy-fiado.util.ts` (novo, só teste: grava no
  banco descartável uma dívida antiga com as mesmas linhas que o código removido gravava).
- `test/receivables-orders.e2e-spec.ts` (removido: testava vender fiado; as garantias sobre dívidas
  existentes foram levadas para `fiado-disabled`).
- Adaptados: `receivables`, `financial-chain`, `reports`, `orders-cancel-reason`, `tab-kitchen-flow`.

**Web**
- `app/dashboard/pdv/page.tsx`, `app/dashboard/mesas/[tableId]/page.tsx`, `app/dashboard/fiado/page.tsx`.
- `components/receivables/CustomerCreditPanel.tsx`, `components/customers/CustomerDetailDialog.tsx`,
  `components/shell/nav.ts`.
- Removidos: `components/receivables/CreditTermsField.tsx`, `components/receivables/NewChargeDialog.tsx`.
- `lib/receivables-api.ts`, `lib/receivables-logic.ts` (+ teste), `lib/tab-checkout-logic.ts`
  (+ teste), `lib/pos-api.ts`, `lib/tabs-api.ts`, `lib/permissions.ts`.

## 6. Testes

Todos em bancos descartáveis (`rs_fiado_e2e` e `rs_fiado_full`, container `rs-adic-pg`), com as 21
migrations da base e o seed novo (69 permissões).

| Suíte | Resultado |
|---|---|
| API unitários | **45 suítes / 439 testes — todos passaram** |
| Web unitários | **42 suítes / 434 testes — todos passaram** |
| Typecheck e lint (API; web nos arquivos alterados) | sem erros |
| E2E afetados, um por vez | `fiado-disabled` 15/15, `receivables` 34/34, `financial-chain` 9/9, `reports` 26/26, `orders-cancel-reason` 6/6, `tab-kitchen-flow` 36/36, `error-messages` 3/3 |
| **E2E completa** (banco novo `rs_fiado_full`, um processo, 482 s) | **64 de 64 suítes, 933 de 933 testes — todos passaram**, numa única execução (pico de heap 1.410 MB). A base tinha 65 suítes: `receivables-orders` saiu e `fiado-disabled` entrou; as CLIs passaram nesta execução |

**Cobertura pedida:**

| Pedido | Onde |
|---|---|
| Venda em dinheiro, PIX e cartão (PDV) | `fiado-disabled`: as três formas; só dinheiro entra no caixa |
| Cartão de crédito e de débito | O sistema tem **uma** forma "Cartão" (`CARD`), que cobre as duas — ver pendência 2 |
| Fechamento de comanda | `fiado-disabled` e `tab-kitchen-flow`: dinheiro, PIX e cartão gravam o pagamento; fiado recusado e a comanda continua aberta |
| Fechamento de caixa | `fiado-disabled`: abre, vende, fecha sem diferença; `cash`, `reports` |
| Cancelamentos e estornos | `fiado-disabled`, `financial-chain`, `orders-cancel-reason`, `receivables`, `cash-sale-refund` |
| Relatórios financeiros | `reports` (fiado antigo continua em "por forma de pagamento" e no caixa) e `fiado-disabled` |
| Histórico de vendas | `fiado-disabled`: o pedido antigo continua `ON_ACCOUNT` no detalhe |
| Rejeição de novas vendas fiadas | PDV (dono e caixa, com e sem parcelas), comanda, checkout público (`error-messages`), idempotência (`financial-chain`), rotas de crédito 404 |
| Acesso a recebíveis históricos | `receivables` (34 testes: receber, estornar, cancelar, vencidos, concorrência, auditoria) e `fiado-disabled` |
| Isolamento entre restaurantes | `receivables` e `fiado-disabled` |
| Permissões | `receivables` (matriz por papel) e `fiado-disabled` (`receivables.sell` não existe em papel nenhum) |

## 7. Assistente de WhatsApp

Na branch `assistente-whatsapp` (separada desta), o assistente:
- nunca teve ferramenta de pagamento; o link leva ao checkout público, que só aceita dinheiro, PIX
  ou cartão e recusa fiado;
- ganhou uma regra fixa no provedor de IA ("nunca ofereça fiado, venda a prazo ou pagar depois") e,
  no assistente local, uma resposta própria para perguntas sobre fiado e formas de pagamento, com
  testes.

## 8. Migrations

**Nenhuma.** A desativação é funcional. Remover dados ou colunas (por exemplo
`creditLimitCents` ou o valor `ON_ACCOUNT`) apagaria a explicação do histórico e não foi feito.
Também não é preciso aplicar nada no DEV para esta mudança funcionar: ao subir a API nova, as
linhas antigas da permissão `receivables.sell` no banco ficam sem uso (nenhuma rota a exige).
Se quiser removê-las depois, é uma limpeza opcional, com backup.

## 9. Pendências e riscos

1. **Aprovação** para integrar à `salto-desenvolvimento` (nada foi integrado).
2. **Cartão de crédito e débito:** hoje existe uma única forma "Cartão". Separar em crédito e débito
   é uma funcionalidade nova (exige migration do enum e ajustes no PDV, comandas, checkout,
   relatórios e caixa) — fica para uma decisão sua.
3. **Clientes com fiado em aberto no DEV:** continuam devendo e podem ser regularizados pela tela
   "Contas a receber". Vale conferir quantos existem antes de integrar.
4. A linha da permissão `receivables.sell` permanece no banco DEV até uma limpeza opcional.
5. Se algum cliente de API externo enviava `ON_ACCOUNT` ou `creditTerms`, passa a receber 400.
6. Risco baixo: a mudança só remove caminhos de criação; os caminhos de leitura e regularização
   são os mesmos de antes e estão cobertos pelos testes.

## 10. Segurança dos ambientes

Não foram tocados: `restaurant-saas-final`, a apresentação acadêmica, `master`, produção, DEV (nenhuma
conexão e nenhuma migration), as branches `assistente-whatsapp` (exceto o item da seção 7, em
commit próprio nela) e `adicionais-pdv-comandas`, e os 78 produtos da Do'cê. Nenhum dado
financeiro foi apagado. Nenhum push, nenhum deploy.
