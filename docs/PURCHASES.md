# Compras de estoque

Módulo de compras e fornecedores, integrado ao estoque profissional (`docs/INVENTORY.md`). Registra a compra de insumos, recebe-a e gera a entrada de estoque pelo `StockLedgerService` existente.

## Estados

| Estado | Pode editar | Estoque | Observações |
|---|---|---|---|
| `DRAFT` | sim (itens, fornecedor, data, custos) | não altera | Pode ser cancelada sem efeito no estoque |
| `RECEIVED` | não | uma `ENTRY` por item | Tem `receivedAt` e `receivedBy`; só pode ser cancelada com motivo |
| `CANCELLED` | não | estornado, se já estava recebida | Nada é apagado; `cancelledAt`, `cancelledBy` e `cancelReason` ficam gravados |

Não existe exclusão física de compra.

## Fluxo de recebimento

`POST /v1/purchases/:id/receive` (ou `POST /v1/purchases` com `receiveNow: true`):

1. valida tenant e acesso à unidade;
2. abre uma transação e trava a linha da compra (`FOR UPDATE`);
3. se já está `RECEIVED`, devolve a compra com `idempotentReplay: true`; se está `CANCELLED`, responde 409;
4. exige ao menos um item, insumos ativos do tenant e validade nos insumos que a controlam;
5. ordena os itens por insumo (evita deadlock entre compras concorrentes) e chama `StockLedgerService.apply` para cada um, com `type = ENTRY`, `origin = PURCHASE`, custo unitário, lote, validade, nome do fornecedor e número da compra como documento;
6. marca a compra como `RECEIVED` com `receivedAt` e `receivedBy`;
7. confirma a transação e grava a auditoria `PURCHASE_RECEIVED`.

Qualquer falha desfaz tudo: não existe compra recebida sem estoque nem estoque sem compra recebida.

**Idempotência e concorrência:** além do estado, cada entrada referencia `(PURCHASE, purchaseItem.id)` e usa a unique `(referenceType, referenceId, inventoryItemId, type)` do ledger como trava no banco. Editar e receber ao mesmo tempo se serializam pela trava da linha da compra.

## Cancelamento

- **`DRAFT`:** vira `CANCELLED`, sem estoque.
- **`RECEIVED`:** exige `reason` (mínimo 3 caracteres). Para cada entrada gera um `REVERSAL` negativo pelo ledger, referenciando o mesmo item da compra. Se o saldo não cobre a quantidade (e a unidade não permite estoque negativo), responde 409 `INSUFFICIENT_STOCK` e nada muda. Chamar de novo depois de cancelada devolve a compra com `idempotentReplay: true`.
- O custo médio do insumo **não** é recalculado no estorno, como em qualquer saída do ledger.

## Valores

- Tudo em centavos inteiros. O total de cada linha é `quantidade × custo unitário`, arredondado meio para cima. O total da compra é `subtotal − desconto + frete + outros custos` e não pode ser negativo.
- O backend recalcula os totais e rejeita (400) qualquer `totalCents`, `subtotalCents` ou `totalCostCents` enviado pelo cliente.
- O custo do estoque usa o custo unitário de cada item. Frete, desconto e outros custos ficam só no total da compra, sem rateio.
- A quantidade é sempre na unidade de estoque do insumo (`Decimal(14,3)`); não há conversão de unidade na compra.

## Fornecedores

`Supplier` pertence ao tenant, com nome obrigatório e documento, telefone, e-mail e observações opcionais. Não há dados inventados nem validação de CNPJ. Nome duplicado entre fornecedores ativos é recusado. Fornecedor inativo não pode ser usado em compras novas ou editadas, mas o histórico das compras antigas permanece. O nome do fornecedor é gravado no `StockMovement` (`supplierName`) no recebimento.

## API

| Método e rota | Permissão |
|---|---|
| `GET /v1/purchases?branchId=&status=&supplierId=&dateFrom=&dateTo=&search=&page=&pageSize=` | `purchases.read` |
| `GET /v1/purchases/:id` | `purchases.read` |
| `POST /v1/purchases` | `purchases.create` (`receiveNow` exige também `purchases.receive`) |
| `PATCH /v1/purchases/:id` | `purchases.update` |
| `POST /v1/purchases/:id/receive` | `purchases.receive` |
| `POST /v1/purchases/:id/cancel` | `purchases.cancel` |
| `GET /v1/suppliers`, `GET /v1/suppliers/:id` | `suppliers.read` |
| `POST /v1/suppliers` | `suppliers.create` |
| `PATCH /v1/suppliers/:id` | `suppliers.update` |

A listagem devolve, na mesma resposta, os totais por situação (`summary`) usados nos indicadores da tela, sem consultas por linha. O detalhe inclui itens, responsáveis e o histórico da auditoria.

## Permissões

OWNER e ADMIN têm todas; MANAGER tem todas as de compras e fornecedores. CASHIER, KITCHEN, WAITER, DELIVERY e VIEWER não têm acesso. As permissões são criadas pelo seed (`pnpm db:seed`); em bancos existentes é preciso rodar o seed e os usuários precisam entrar de novo para receber as novas permissões.

## Isolamento

`tenantId` vem sempre do token. Compra, fornecedor e insumo de outro tenant respondem 404. Usuário sem vínculo com a unidade recebe 403 ao listar ou criar naquela unidade e 404 ao acessar uma compra dela.

## Auditoria

`PURCHASE_CREATED`, `PURCHASE_UPDATED`, `PURCHASE_RECEIVED` (com unidade e ids dos movimentos de estoque), `PURCHASE_CANCELLED` (com status anterior, motivo e ids dos estornos), `SUPPLIER_CREATED` e `SUPPLIER_UPDATED`.

## Banco

Migration `20260930100000_purchases`: tabelas `suppliers`, `purchases`, `purchase_items` e `purchase_sequences`, o enum `PurchaseStatus`, o valor `PURCHASE` em `StockReferenceType` e CHECKs de valores não negativos. A numeração `COMP-000001` é sequencial por restaurante, atribuída na mesma transação da criação.

## Telas

`/dashboard/estoque/compras` (indicadores, filtros por período, situação, fornecedor e busca, tabela e ações), `/dashboard/estoque/compras/nova`, `/dashboard/estoque/compras/[id]` e `/dashboard/estoque/compras/[id]/editar`. A aba só aparece para proprietários, administradores e gerentes. "Salvar e receber" numa compra nova cria e recebe numa única transação; numa compra existente salva as alterações e depois recebe.

## Fora do escopo

Pedido de compra, sugestão de compra, contas a pagar, rateio de frete no custo, conversão de unidade na compra e importação de nota fiscal de entrada.
