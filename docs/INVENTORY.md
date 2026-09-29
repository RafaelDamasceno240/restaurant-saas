# Estoque

Controle de estoque **por unidade (Branch)**, integrado ao cardápio e aos pedidos. Código em `apps/api/src/modules/inventory/`, telas em `apps/web/app/dashboard/estoque/`.

## Arquitetura

```
Tenant
 ├── InventoryItem (catálogo de insumos do tenant)
 ├── ProductRecipe → ProductRecipeItem → InventoryItem (ficha técnica)
 └── Branch
      ├── InventoryBalance (saldo e custo médio de cada insumo nesta unidade)
      ├── StockMovement (histórico imutável)
      └── InventoryCount → InventoryCountItem (inventários físicos)
```

| Serviço | Responsabilidade |
|---|---|
| `StockLedgerService` | Único ponto que altera saldo: trava a linha do saldo, valida estoque negativo, recalcula custo médio e grava o movimento |
| `InventoryService` | Integração com pedidos: `consumeForOrderInTx` e `reverseForOrderInTx`, sempre dentro da transação do pedido |
| `InventoryItemsService` | Cadastro de insumos e visão com saldo, valor e status |
| `StockMovementsService` | Entrada e saída manuais e histórico com filtros |
| `RecipesService` | Ficha técnica, custo e margem |
| `InventoryCountsService` | Inventário físico e ajustes |
| `InventoryOverviewService` | Resumo, alertas, saldos e configuração da unidade |
| `inventory-calculations.ts` | Regras puras (unidades, custos, margem, status, consumo, validade), testadas sem banco |

PDV, pedido online e checkout de mesa usam o **mesmo** `InventoryService`: não existe estoque separado por canal.

## Modelos

| Modelo | Campos principais |
|---|---|
| `InventoryItem` | `name`, `sku?` (único por tenant), `unit` (imutável), `minStock`, `maxStock?`, `tracksExpiry`, `notes?`, `active` |
| `InventoryBalance` | `branchId` + `inventoryItemId` (único), `quantity`, `averageCostCents` |
| `StockMovement` | `type`, `origin`, `quantity` (delta com sinal), `balanceAfter`, `unitCostCents`, `exitReason?`, `notes?`, `supplierName?`, `documentNumber?`, `lotCode?`, `expiresAt?`, `referenceType?` + `referenceId?`, `createdByUserId`, `createdAt` |
| `ProductRecipe` / `ProductRecipeItem` | um por produto; `quantity` na unidade de estoque e `inputUnit` (unidade informada pelo usuário) |
| `InventoryCount` / `InventoryCountItem` | `systemQuantity` (saldo travado no ajuste), `countedQuantity`, `difference`, `stockMovementId?` |
| `Branch.allowNegativeStock` | configuração de estoque negativo por unidade (padrão `false`) |

Migrations:

- `20260928232435_inventory`: criação do módulo e do trigger de imutabilidade.
- `20260929010000_inventory_professional`: evolução profissional. Os dados existentes foram **preservados**:
  - `SALE_REVERSAL` foi renomeado para `REVERSAL` via `ALTER TYPE … RENAME VALUE`;
  - `reason` foi renomeado para `notes` via `RENAME COLUMN`;
  - `origin` foi preenchido pelo tipo: SALE→ORDER, REVERSAL→REVERSAL, ADJUSTMENT→INVENTORY, demais→MANUAL;
  - saídas antigas receberam o motivo `OTHER`.

  O trigger de imutabilidade é desligado **somente** durante esse backfill, dentro da migration.

## Unidades

`UNIT` (UN), `KG`, `G`, `L`, `ML`, organizadas em três famílias: contagem, massa e volume. A conversão só ocorre dentro da mesma família, por fator fixo (1 KG = 1000 G, 1 L = 1000 ML).

- A unidade de estoque é escolhida no cadastro e **não pode ser alterada**. O `PATCH` com `unit` retorna 400.
- Na ficha técnica, a quantidade pode ser informada em unidade compatível (`150 G` para um insumo em KG). O backend grava `0,150` na unidade de estoque e guarda `inputUnit` para exibir de volta como "150 G".
- Unidade incompatível retorna `INCOMPATIBLE_UNIT`. Uma conversão que exigiria mais de 3 casas retorna `INVALID_PRECISION` (sem arredondar em silêncio).

## Quantidade e dinheiro

- **Quantidade:** `DECIMAL(14,3)` no PostgreSQL. A aritmética usa `Prisma.Decimal` (base 10 exata). O JSON de entrada (até 3 casas) é convertido pela forma em string, e o JSON de saída é só exibição.
- **Dinheiro:** centavos inteiros (`unitCostCents`, `averageCostCents`, `priceCents`).
- **Custo médio ponderado:** `(saldo × médio + qtd × custo) / (saldo + qtd)`, com arredondamento half-up para o centavo. Saldo zero ou negativo não entra na média. É recalculado a cada ENTRY e a cada estorno de venda.
- **Valor em estoque:** `max(saldo, 0) × custo médio`, arredondado por insumo.
- **Totais do período (entradas, saídas, perdas):** `Σ |quantidade| × custo unitário do movimento`, somados de forma exata e arredondados uma vez.

## Ficha técnica, custo e margem

- `PUT /v1/inventory/recipes/:productId` substitui a ficha. Lista vazia remove a ficha, e insumo repetido é rejeitado.
- **Custo da linha:** `quantidade × custo médio do insumo na unidade`, arredondado.
- **Custo da ficha:** soma das linhas.
- **Margem:** `preço − custo` em centavos. A margem % tem uma casa decimal.
- **Tudo é calculado no backend** (`GET /recipes` e `GET /recipes/:productId?branchId=`). O frontend só exibe.
- Produto sem ficha não movimenta estoque e gera o alerta `NO_RECIPE`.

## Movimentações

| Tipo | Origem | Como nasce |
|---|---|---|
| `ENTRY` | `PURCHASE` se informar fornecedor ou documento, senão `MANUAL` | Nova entrada |
| `EXIT` | `MANUAL` | Nova saída, com motivo `CONSUMPTION`, `LOSS`, `DAMAGE`, `ADJUSTMENT` ou `OTHER` (este exige observação) |
| `ADJUSTMENT` | `INVENTORY` | Inventário físico (referência `INVENTORY_COUNT`) |
| `SALE` | `ORDER` | Confirmação de pedido (referência `ORDER`) |
| `REVERSAL` | `REVERSAL` | Cancelamento de pedido já baixado (referência `ORDER`) |

- `POST /v1/inventory/movements` aceita apenas `ENTRY` e `EXIT`, com quantidade maior que zero. Ajuste só acontece pelo inventário, e venda e estorno só pelo backend.
- **Imutabilidade:** não há rota de update ou delete, e o trigger `stock_movements_no_update_delete` rejeita UPDATE e DELETE no banco. Toda correção é um novo movimento.
- **Histórico:** filtros por período, tipo, origem, insumo, usuário e busca (insumo, observação, fornecedor, documento, lote). Os mais recentes vêm primeiro.

## Inventário físico

`POST /v1/inventory/inventory-counts` com `{ branchId, notes?, items: [{ inventoryItemId, countedQuantity }] }`. Em uma única transação:

1. cria o `InventoryCount`;
2. para cada insumo, em ordem de id, trava o saldo e usa esse saldo **travado** como `systemQuantity`;
3. se `diferença = contado − sistema` for diferente de zero, gera um `ADJUSTMENT` com origem `INVENTORY`, referência à contagem e o usuário responsável;
4. grava o `InventoryCountItem`, mesmo sem diferença, porque isso também registra a conferência.

Exemplo: sistema 10 KG, contado 8,5 KG → `ADJUSTMENT −1,5 KG`. O saldo **nunca** é editado diretamente.

## Validade e lote

- ENTRY aceita `lotCode` e `expiresAt` opcionais. Se o insumo tem `tracksExpiry`, a validade é obrigatória (`EXPIRY_REQUIRED`).
- Não existe consumo FIFO/FEFO. Para os alertas, o sistema **estima** o que ainda está em estoque atribuindo o saldo atual às entradas mais recentes (`estimateEntriesOnHand`).
  - Exemplo: saldo 7, com entradas de 5 (nova) e 10 (antiga) → 5 da nova e 2 da antiga.
  - Só as entradas estimadas em mãos geram alerta.
- **Alertas de validade:**
  - `EXPIRED`: a data já passou;
  - `EXPIRING_SOON`: vence em até **7 dias** (`EXPIRY_WARNING_DAYS`).
  - A contagem de dias usa a data em UTC.
- **Evolução futura:** uma tabela de lotes com saldo por lote, para permitir FIFO/FEFO real, sem mudar a API atual.

## Alertas e resumo

- `GET /v1/inventory/alerts?branchId=` lista, em ordem de prioridade: `OUT_OF_STOCK`, `EXPIRED`, `LOW_STOCK`, `EXPIRING_SOON` e `NO_RECIPE`, com as contagens.
- **Status do insumo:** é derivado e nunca persistido. `OUT_OF_STOCK` quando saldo ≤ 0, `LOW_STOCK` quando saldo ≤ mínimo, e `OK` nos demais casos.
- `GET /v1/inventory/summary?branchId=&from=&to=` retorna:
  - valor em estoque;
  - quantidade de itens baixos e sem estoque;
  - entradas, saídas (inclui vendas) e perdas (`LOSS` + `DAMAGE`) no período, com contagem e valor;
  - contagem de alertas;
  - os 8 movimentos mais recentes.
- O período padrão é de 30 dias.

## Baixa automática e cancelamento

- **Regra única:** o pedido consome estoque quando deixa `PENDING` para um status confirmado (`statusConsumesStock`).
  - Online e PDV baixam na transição `PENDING → CONFIRMED` (painel ou KDS), dentro de `OrdersService.updateStatus`.
  - O checkout de mesa nasce `COMPLETED` e baixa em `OrderCreationService.createPricedOrderInTx`.
- **Consumo:** ficha × quantidade, agregado por insumo. Por exemplo, 2 × X-Burger com 150 G de carne consome 300 G.
- **Mesma transação:** a mudança de status e a baixa são uma transação só, com a linha do pedido travada. Se faltar insumo com estoque negativo desligado, a resposta é `409 INSUFFICIENT_STOCK` e o pedido continua `PENDING`.
- **Cancelamento após a baixa:** gera movimentos `REVERSAL` que compensam **exatamente** os `SALE` gravados, e não a ficha atual. O histórico nunca é apagado.

## Idempotência

- **Constraint única:** `@@unique([referenceType, referenceId, inventoryItemId, type])`. Um pedido tem no máximo um `SALE` e um `REVERSAL` por insumo, e uma contagem tem no máximo um `ADJUSTMENT` por insumo.
- **Verificação prévia:** `consumeForOrderInTx` e `reverseForOrderInTx` verificam movimentos existentes antes de gravar. Reprocessar o mesmo pedido não faz nada (coberto por teste).
- **Confirmações simultâneas:** se serializam no lock do pedido, e a segunda recebe `409`.

## Concorrência

Toda alteração de saldo passa por `StockLedgerService`:

1. `INSERT … ON CONFLICT (branchId, inventoryItemId) DO NOTHING` garante que a linha de saldo existe.
2. `SELECT … FOR UPDATE` trava a linha **antes** de ler o saldo.
3. Valida o estoque negativo sobre o saldo travado, atualiza o saldo e grava o movimento, tudo na mesma transação.

Em operações com vários insumos (pedido, inventário), as linhas são travadas em ordem de `inventoryItemId`, o que evita deadlock. Nunca se confia em `if (saldo >= quantidade)` fora do lock.

**Teste obrigatório, coberto de duas formas:** com saldo 5, duas saídas manuais simultâneas de 4 e de 3, e também **duas vendas** (4 e 3 unidades) confirmadas ao mesmo tempo. Com estoque negativo desligado, exatamente uma é aceita e a outra recebe `INSUFFICIENT_STOCK`. Na venda recusada, o pedido permanece `PENDING`.

## Estoque negativo

Controlado por `Branch.allowNegativeStock` (`GET` e `PATCH /v1/inventory/settings`), com padrão `false`, e aplicado apenas no backend.

- **Desligado:** qualquer saída ou venda que deixaria o saldo negativo é bloqueada.
- **Entradas, estornos e ajustes de inventário:** nunca são bloqueados. O ajuste leva o saldo a um valor contado, que é sempre ≥ 0.

## Permissões

| Permissão | OWNER / ADMIN / MANAGER | CASHIER | KITCHEN | WAITER |
|---|---|---|---|---|
| `inventory.read` | ✓ | ✓ | ✓ | — |
| `inventory.create`, `inventory.update` | ✓ | — | — | — |
| `inventory.movement.create` | ✓ | — | — | — |
| `inventory.recipe.manage` | ✓ | — | — | — |
| `inventory.count` | ✓ | — | — | — |

- A KITCHEN confirma pedidos (`orders.update`), e isso baixa estoque como efeito da regra do pedido, não como movimento manual.
- As permissões vão no JWT: após `pnpm db:seed`, usuários já logados precisam entrar de novo.

## Tenant e unidade

- O `tenantId` vem sempre do JWT. Registros de outro tenant respondem 404, igual a inexistentes.
- Todo endpoint por unidade valida `branchId` com `BranchAccessService`:
  - unidade de outro tenant: 404;
  - unidade sem vínculo: `403 BRANCH_ACCESS_DENIED`;
  - OWNER e ADMIN acessam todas as unidades.

## Endpoints (`/v1/inventory`)

| Método | Rota | Permissão |
|---|---|---|
| GET | `/summary?branchId=&from=&to=` | read |
| GET | `/alerts?branchId=` | read |
| GET | `/balances?branchId=` | read |
| GET / POST | `/items` (`?branchId=&search=&status=`) | read / create |
| GET / PATCH | `/items/:id` | read / update |
| GET / POST | `/movements` (filtros: `type`, `origin`, `inventoryItemId`, `createdByUserId`, `from`, `to`, `search`, `page`) | read / movement.create |
| GET | `/recipes?branchId=&search=` | read |
| GET / PUT | `/recipes/:productId` | read / recipe.manage |
| POST | `/inventory-counts` | count |
| GET / PATCH | `/settings` | read / update |

## Auditoria

- **Insumos:** `INVENTORY_ITEM_CREATED` e `INVENTORY_ITEM_UPDATED`.
- **Movimentos:** `INVENTORY_MOVEMENT_CREATED`, tanto para entrada e saída manuais quanto para baixa e estorno por pedido.
- **Ficha técnica:** `INVENTORY_RECIPE_UPDATED`.
- **Inventário:** `INVENTORY_COUNT_CREATED` e um `INVENTORY_ADJUSTMENT` por ajuste gerado.
- **Configuração:** `INVENTORY_SETTINGS_UPDATED`.

## Telas

`/dashboard/estoque` tem abas navegáveis por rota:

- **Visão geral:** indicadores, alertas com filtros rápidos (Todos, Baixo estoque, Sem estoque, Validade, Sem ficha), configuração da unidade e atividade recente.
- **Insumos (`/insumos`):** tabela com estoque, mínimo e máximo, custo médio, valor e status, com as ações Editar, Entrada, Saída e Histórico.
- **Ficha técnica (`/fichas`):** custo, preço, margem e quanto é produzível. O detalhe mostra insumo, quantidade, unidade, custo e subtotal.
- **Movimentações (`/movimentacoes`):** filtros e busca.
- **Compras (`/compras`):** em breve.
- **Inventário (`/inventario`):** contagem física, com prévia da diferença e confirmação antes do ajuste.

## Fora do escopo

Ficou para fases futuras:

- compras e fornecedores completos;
- transferência entre unidades;
- FIFO/FEFO;
- inventário avançado (contagem cega, múltiplos contadores);
- CMV;
- previsão de demanda;
- integração contábil;
- "Quando o estoque zerar: pausar produto / vender sob encomenda", que fica apenas visual, porque `Product.active` vale para o tenant inteiro.
