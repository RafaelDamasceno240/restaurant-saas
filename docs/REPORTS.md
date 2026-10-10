# Relatórios operacionais (Fase 11, fatia 8)

Estado real implementado em 2026-10-05. Seis relatórios somente leitura sobre o que os outros módulos já gravam: vendas, produtos, clientes, estoque, delivery e caixa.

## Regras comuns

1. **Tenant** sempre do token. Nenhum parâmetro de tenant é aceito.
2. **Unidade:** `branchId` é opcional. Com ele, o acesso é conferido (`404` se a unidade é de outro restaurante, `403` se o usuário não está vinculado a ela). Sem ele, o relatório cobre **exatamente** as unidades a que o usuário está vinculado: todas para proprietário e administrador; um gerente sem vínculo não vê nada.
3. **Período:** `from` e `to` são **dias de calendário** (`YYYY-MM-DD`) **no fuso do restaurante** (`tenants.timezone`), os dois inclusive. Uma venda às 23:30 em São Paulo pertence àquele dia, embora já seja o dia seguinte em UTC. Agrupamentos "por dia" e "por hora" usam o mesmo fuso.
   - sem datas: os últimos 30 dias até hoje; só `from`: até hoje; só `to`: 30 dias terminando nele;
   - máximo de **366 dias**;
   - erros `400`: `REPORT_DATE_INVALID`, `REPORT_RANGE_INVERTED`, `REPORT_RANGE_TOO_LONG`.
4. **Venda** = pedido **não cancelado**, contado no dia em que foi **criado**. Cancelados aparecem à parte, nunca somados.
5. **Dinheiro em centavos inteiros.** Percentuais em pontos-base (7742 = 77,42%).
6. **Sem N+1:** tudo é agregado pelo banco em um número fixo de consultas por relatório, qualquer que seja o tamanho do resultado. Toda lista que pode crescer é **paginada** (`page`, `pageSize` até 100, padrão 20).
7. A resposta devolve o período efetivamente usado: `period: { from, to, timezone, days }` e `branchId`.

Permissão única: **`reports.read`** (proprietário, administrador e gerente). Caixa, garçom, cozinha, entregador e visualizador recebem `403`.

## Endpoints

Todos `GET /v1/reports/...`, autenticados.

| Rota | Parâmetros além de `from`, `to`, `branchId` | O que devolve |
|---|---|---|
| `/sales` | — | totais, por dia, por hora, por forma de pagamento, origem e tipo de atendimento |
| `/products` | `sort` = `revenue` (padrão) ou `quantity`; `search`; `categoryId`; paginação | produtos vendidos, com quantidade, faturamento e participação |
| `/customers` | `sort` = `total` (padrão) ou `orders`; paginação | clientes que compraram; pedidos identificados x sem cadastro |
| `/inventory` | `sort` = `consumption` (padrão), `loss` ou `name`; `search`; paginação | entradas, consumo, saídas e perdas por insumo |
| `/delivery` | — | entregas por situação, tempos, taxas e desempenho por entregador |
| `/cash` | paginação | sessões de caixa abertas no período, com totais e diferenças |

### Vendas

- `totals`: `ordersCount`, `itemsCents` (subtotal dos itens), `discountCents` (cupons), `cashbackUsedCents`, `deliveryFeeCents`, `totalCents`, `averageTicketCents`.
  `totalCents = itemsCents − discountCents − cashbackUsedCents + deliveryFeeCents`, a mesma fórmula de cada pedido.
- `concludedCount`/`concludedCents`: parte das vendas já concluída (`COMPLETED` ou `DELIVERED`).
- `onAccountCents`: parte das vendas feita fiado (vendida, ainda a receber).
- `cancelledCount`/`cancelledCents`: pedidos cancelados, **fora** das vendas.
- `byDay`: uma linha por dia do período, inclusive dias sem venda. `byHour`: sempre 24 linhas (hora local).
- `byPaymentMethod`, `bySource`, `byFulfillment`: `{ key, ordersCount, totalCents }`, do maior para o menor.

### Produtos

Faturamento do produto = quantidade × preço unitário **no momento da venda** (o snapshot do item). Cupom e cashback descontam o **pedido**, não um produto, então não são rateados: a soma dos produtos é o `itemsCents` das vendas, não o `totalCents`. `shareBps` é a participação no faturamento de tudo que atende aos filtros. O nome e a categoria exibidos são os atuais do cadastro.

### Clientes

Ranking dos clientes cadastrados com pedido no período. `totals` separa pedidos **identificados** (com cliente vinculado) dos **sem cadastro**, e traz `customersCount` (quantos compraram) e `newCustomers` (cadastros criados no período; o cadastro é do restaurante, não da unidade).

### Estoque

Complementa `GET /v1/inventory/summary` (posição, alertas e totais de **uma** unidade): aqui está o ranking **por insumo** do que entrou, foi consumido e se perdeu.

- **Entradas:** `ENTRY`, menos compras canceladas (`REVERSAL` de compra).
- **Consumo por vendas:** `SALE`, menos pedidos cancelados (`REVERSAL` de pedido), que devolvem o insumo.
- **Saídas manuais:** `EXIT` por consumo ou outro motivo.
- **Perdas:** `EXIT` com motivo perda ou avaria.
- Valores pelo custo gravado em cada movimentação (custo médio da época). `currentQuantity` é o saldo **atual** nas mesmas unidades, não o saldo no fim do período.

### Delivery

Entregas **criadas** no período. `successRateBps` = entregues ÷ (entregues + falhas + canceladas). `averageRouteMinutes` = despacho até a entrega; `averageDoorMinutes` = pedido feito até a entrega; ambos `null` sem entregas concluídas. `feeCents` soma a taxa dos pedidos não cancelados. `byCourier` lista até 100 entregadores, com uma linha `courierId: null` para entregas sem entregador atribuído.

### Caixa

Sessões **abertas** no período, da mais nova para a mais antiga. Por sessão: saldo inicial, vendas em dinheiro, suprimentos, sangrias, fiado recebido e estornado, saldo esperado (o gravado no fechamento; calculado dos movimentos enquanto aberta), contado e diferença. `totals` soma os movimentos de todas as sessões do período e separa `shortageCents` (faltas, negativo) de `surplusCents` (sobras), que só existem em sessões fechadas.

## Implementação

- `apps/api/src/modules/reports/`: `reports.service.ts` (SQL parametrizado com `Prisma.sql`; nenhuma concatenação de texto), `report-period.ts` (regra do período, pura e testada), `dto/reports.dto.ts`, `reports.controller.ts`.
- Dia e hora locais: `("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE <fuso>`. Os limites do período viram instantes (`[início do primeiro dia, início do dia seguinte ao último)`) por `startOfDayInTimeZone`, que respeita horário de verão.
- Consultas por relatório: vendas 4, produtos 2, clientes 3, estoque 3, delivery 3, caixa 4 (mais 1 para o fuso do tenant e, com usuário limitado, 1 para suas unidades).
- Índices usados: `orders (tenantId, createdAt)` e `(tenantId, branchId, createdAt)`, `deliveries (tenantId, createdAt)`, `cash_register_sessions (tenantId, openedAt)`, `stock_movements (tenantId, branchId, createdAt)`. **Nenhuma migration nova.**
- A busca por nome escapa `%`, `_` e `\` e vai como parâmetro.

## Frontend

Menu **Relatórios** → `/dashboard/relatorios` (proprietário, administrador, gerente).

- Filtro comum: período (Hoje, Ontem, 7 dias, 30 dias, Este mês, Mês passado ou datas), e unidade.
- Abas Vendas, Produtos, Clientes, Estoque, Delivery e Caixa.
- Gráficos sem biblioteca: barras em HTML, cada uma com descrição em texto.
- Um período inválido digitado não é enviado: a tela avisa e mantém o último válido.

## Limitações

- Sem exportação (CSV, PDF) e sem agendamento ou envio por e-mail.
- Sem comparação com o período anterior e sem metas.
- Sem margem ou lucro por produto (o custo da ficha técnica não é cruzado com o preço de venda).
- "Venda" é contada pela data de **criação** do pedido; não há visão por data de conclusão nem regime de caixa (o que foi efetivamente recebido está no relatório de caixa e em Contas a receber).
- Os presets de período usam a data do aparelho; se o fuso do aparelho for diferente do fuso do restaurante, "Hoje" pode divergir em um dia perto da meia-noite. O período exibido é sempre o que a API usou.
- Sem cache: cada consulta agrega na hora. Suficiente para o volume de um restaurante; um período de um ano em um tenant muito grande pede tabelas de resumo.
- `byCourier` limitado a 100 linhas.
- **Venda em dinheiro cancelada:** o relatório de vendas deixa de contá-la; no caixa, o movimento de venda continua (o histórico não é reescrito) e o cancelamento grava um **estorno de venda** (`SALE_REFUND`) na sessão aberta. O relatório de caixa mostra `salesCents` bruto e `saleRefundsCents` à parte: "Dinheiro" do relatório de vendas = vendas em dinheiro − estornos de venda, quando as duas coisas caem no mesmo período. Vendas em dinheiro canceladas antes da migration `20261010230000_cash_sale_refund` não têm estorno (ver `docs/CASH_REGISTER_PLAN.md`).

## Deploy

1. Nenhuma migration.
2. `pnpm db:seed` (permissão `reports.read`) e novo login.
