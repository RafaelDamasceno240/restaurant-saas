# Plano da Fatia 08 — Caixa

> **Status: IMPLEMENTADO (Fatia 08).** As seções 1–24 abaixo são o plano
> original; a seção **"Decisões tomadas na implementação"** no final registra
> o que foi efetivamente decidido e **prevalece** sobre o plano onde divergir.
>
> **Única pendência de artefato:** a migration Prisma ainda não foi gerada
> (sem CLI/engine do Prisma nem rede neste ambiente). O schema e o SQL de
> constraints estão prontos; o primeiro `pnpm db:migrate` + `pnpm db:constraints`
> num ambiente real materializa tudo.

## 1. Objetivo

Dar controle financeiro sobre o dinheiro que entra e sai fisicamente do
estabelecimento por turno de operação: abrir um caixa com um saldo inicial,
registrar sangrias (retiradas) e suprimentos (aportes) durante o turno,
fechar o caixa contando o dinheiro físico, e apurar a diferença entre o
valor esperado (calculado) e o valor contado. Nesta fase, o caixa cobre
principalmente as vendas do **PDV** (fatia 07) pagas em `CASH`; pedidos
online continuam fora do escopo de caixa físico por enquanto (ver seção 17).

## 2. Entidades necessárias

Reaproveitar `Tenant`, `Branch`, `User`, `Order` já existentes. Novas:

- **`CashRegisterSession`** — um turno de caixa (abertura → fechamento).
  Campos: `id`, `tenantId`, `branchId`, `openedByUserId`, `closedByUserId?`,
  `status` (ver seção 3), `openingBalanceCents`, `expectedClosingBalanceCents?`
  (calculado no fechamento, nunca antes), `countedClosingBalanceCents?`,
  `differenceCents?` (`countedClosingBalanceCents - expectedClosingBalanceCents`),
  `openedAt`, `closedAt?`, `notes?`.
- **`CashMovement`** — todo lançamento dentro de uma sessão (sangria,
  suprimento, e futuramente a própria venda em dinheiro). Campos: `id`,
  `sessionId`, `tenantId`, `type` (`WITHDRAWAL` sangria | `SUPPLY`
  suprimento | `SALE` venda — só leitura, gerada automaticamente a partir de
  `Order`, nunca criada manualmente), `amountCents` (sempre positivo; o
  sinal é implícito pelo `type`), `reason?` (obrigatório para `WITHDRAWAL`),
  `orderId?` (preenchido só quando `type = SALE`), `createdByUserId`,
  `createdAt`. **Nunca editável nem removível após criado** (ver seção 4/18).

Não criar uma tabela de "caixa" separada por `Branch` fora de uma sessão —
o caixa físico só existe enquanto há uma `CashRegisterSession` `OPEN`.

## 3. Estados

`CashRegisterSession.status`:

```
OPEN -> CLOSED
```

Sem estados intermediários nesta fase (sem "em conferência", sem
reabertura). Um `CashMovement` não tem estado próprio — ele existe ou não
existe (imutável, ver seção 18).

## 4. Abertura

- `POST /v1/cash/sessions` — cria uma `CashRegisterSession` com `status:
  OPEN`, `openingBalanceCents` informado pelo operador, `openedByUserId` do
  JWT, `branchId` do tenant autenticado.
- **Regra crítica**: não pode haver duas sessões `OPEN` para a mesma
  `(tenantId, branchId)` simultaneamente (ver seção 19, concorrência). A
  tentativa de abrir um segundo caixa enquanto outro está aberto deve
  falhar com um erro de negócio claro (`CASH_SESSION_ALREADY_OPEN`), não
  criar uma segunda sessão silenciosamente.

## 5. Fechamento

- `PATCH /v1/cash/sessions/:id/close` — recebe **somente**
  `countedClosingBalanceCents` (contagem física informada pelo operador) e
  opcionalmente `notes`.
- O backend calcula `expectedClosingBalanceCents` = `openingBalanceCents` +
  soma de `SUPPLY` + soma de `SALE` (em dinheiro) − soma de `WITHDRAWAL`,
  **sempre no momento do fechamento**, nunca aceito do frontend.
- `differenceCents = countedClosingBalanceCents - expectedClosingBalanceCents`
  — calculado e gravado, nunca pedido ao cliente.
- Após fechado (`status: CLOSED`), a sessão e todos os seus `CashMovement`
  tornam-se **congelados**: nenhum endpoint deve permitir alterá-los (ver
  seção 18).

## 6. Sangria (retirada)

- `POST /v1/cash/sessions/:id/movements` com `type: WITHDRAWAL`,
  `amountCents`, `reason` (obrigatório — texto livre, ex. "pagamento de
  fornecedor").
- Só permitida enquanto a sessão está `OPEN`.
- Não permite `amountCents` que deixaria o saldo esperado negativo? A
  decidir na implementação (pode ser permitido com aviso, já que dinheiro
  físico pode ter entrado de outra forma não modelada ainda) — **não
  bloquear rigidamente nesta fase**, apenas registrar; qualquer bloqueio
  duro fica para quando houver mais contexto de uso real.

## 7. Suprimento (aporte)

- `POST /v1/cash/sessions/:id/movements` com `type: SUPPLY`,
  `amountCents`, `reason?` (opcional, diferente da sangria).
- Mesma regra de só permitir com sessão `OPEN`.

## 8. Entradas

Nesta fase, entradas no caixa são: `openingBalanceCents` (na abertura),
`SUPPLY` (manual) e `SALE` (automática, a partir de `Order.paymentMethod =
CASH` criado via PDV — ver seção 17). Pedidos com `PIX`/`CARD` não geram
`CashMovement` (não são dinheiro físico no caixa).

## 9. Saídas

Só `WITHDRAWAL` (sangria) nesta fase. Nenhum outro tipo de saída
(pagamento a fornecedor direto do sistema, etc.) faz parte do escopo.

## 10. Saldo inicial

`openingBalanceCents` — informado pelo operador na abertura, um inteiro em
centavos, sem limite superior imposto pela aplicação (validação de
razoabilidade, se houver, fica a critério da implementação: por exemplo um
teto configurável, não um valor fixo no código).

## 11. Saldo esperado

`expectedClosingBalanceCents` — **sempre calculado no backend no momento do
fechamento**, nunca armazenado incrementalmente a cada movimento (evita
inconsistência se um movimento for inserido fora de ordem) e nunca aceito
do cliente. Fórmula na seção 5.

## 12. Valor contado

`countedClosingBalanceCents` — o único valor monetário que o *operador*
informa no fechamter; representa a contagem física real do dinheiro na
gaveta. Não pode ser inferido nem sugerido pelo sistema.

## 13. Diferença de caixa

`differenceCents` — ver fórmula na seção 5. Positivo = sobra, negativo =
falta. Deve ficar visível de forma proeminente na tela de fechamento e no
histórico da sessão — é o principal indicador operacional desta fatia.

## 14. Auditoria

Reaproveitar `AuditLog` (já existente desde a Fase 01). Ações mínimas:
`CASH_SESSION_OPENED`, `CASH_SESSION_CLOSED`, `CASH_MOVEMENT_CREATED`
(sangria/suprimento). Sempre com `tenantId`, `userId`, `entityId` (sessão
ou movimento) e, no fechamento, `beforeData`/`afterData` com o saldo
esperado vs. contado — o mesmo padrão já usado em `ORDER_STATUS_CHANGED`
(fatia 05).

## 15. Permissões

Sugestão, seguindo o padrão granular já estabelecido:

- `cash.read` — ver sessões/movimentos.
- `cash.open` — abrir sessão.
- `cash.close` — fechar sessão.
- `cash.movement.create` — registrar sangria/suprimento (pode ser o mesmo
  `cash.open`/`cash.close` combinado, ou uma permissão própria — decidir na
  implementação; `cash.read`/`cash.open`/`cash.close` **já existem no seed**
  desde a Fase 01, apenas não conectadas a nada ainda).
- Acesso inicial sugerido: `OWNER`, `ADMIN`, `MANAGER`, `CASHIER` — mesmo
  conjunto de papéis do PDV (fatia 07), já que quem vende no balcão é
  normalmente quem abre/fecha o caixa daquele turno.

## 16. Isolamento por tenant

Mesma regra de sempre, sem exceção: `tenantId` sempre do JWT via
`@CurrentUser()`, nunca do body/query. Uma sessão de caixa e seus
movimentos só são visíveis/alteráveis por usuários do mesmo tenant. Testes
e2e obrigatórios: tenant A não vê/abre/fecha/lança movimento na sessão de
tenant B.

## 17. Relação com pedidos/PDV

- Toda venda do PDV (fatia 07) com `paymentMethod: CASH` **deveria**
  gerar um `CashMovement` do tipo `SALE` automaticamente, vinculado à
  sessão de caixa `OPEN` da branch no momento da criação do pedido.
- **Decisão a confirmar na implementação**: o que fazer se um pedido em
  dinheiro for criado sem nenhuma sessão de caixa `OPEN`? Duas opções
  razoáveis: (a) rejeitar a venda em dinheiro nesse caso (força abrir o
  caixa primeiro); (b) permitir a venda e deixá-la fora de qualquer sessão
  (aparece só no relatório do pedido, não no caixa). Recomendação: começar
  pela opção (a) — mais simples e financeiramente mais segura — e
  reavaliar se atrapalhar o fluxo real de uso.
- Pedidos com `PIX`/`CARD` (do PDV ou online) **não** tocam o caixa físico
  nesta fase.

## 18. Regras transacionais

- Toda escrita que envolva soma/leitura de movimentos (abertura, fechamento,
  criação de movimento) deve ocorrer dentro de uma transação Prisma,
  seguindo o padrão já usado em `OrderCreationService` (fatia 07).
- **Histórico imutável**: uma vez criado, um `CashMovement` nunca é
  editado nem excluído por nenhum endpoint — correções acontecem através de
  um novo movimento compensatório (ex. um `SUPPLY` para reverter uma
  sangria lançada errada), nunca reescrevendo o registro original. O
  fechamento (`CashRegisterSession.status = CLOSED`) também é permanente:
  nenhuma rota deve permitir reabrir ou editar uma sessão fechada.

## 19. Concorrência

- **Evitar dupla abertura**: a checagem "já existe uma sessão OPEN para
  esta branch" e a criação da nova sessão devem acontecer dentro da mesma
  transação (ou usar uma constraint de banco — ex. um índice único parcial
  em `(tenantId, branchId)` onde `status = 'OPEN'`, se o dialeto/Prisma
  permitir de forma direta; caso não permita nativamente, replicar a
  checagem dentro da transação como já se faz hoje para `orderNumber`
  único). Duas requisições de abertura simultâneas para a mesma branch não
  podem resultar em duas sessões `OPEN`.
- Mesmo cuidado para o fechamento: fechar a mesma sessão duas vezes em
  paralelo não pode gerar dois cálculos de `expectedClosingBalanceCents`
  divergentes gravados — a segunda tentativa deve falhar por já não
  encontrar a sessão em `OPEN`.

## 20. Idempotência

- Criação de movimento (sangria/suprimento) não é naturalmente idempotente
  (dois cliques = duas sangrias reais, a princípio) — não implementar
  deduplicação automática nesta fase; é responsabilidade da UI desabilitar
  o botão após o clique (mesmo padrão já usado no checkout e no PDV).
  Registrar explicitamente essa decisão para revisão futura se duplicidade
  acidental se tornar um problema real.
- A geração automática do `CashMovement` tipo `SALE` a partir de um
  `Order` **deve** ser idempotente por `orderId` (um pedido nunca gera dois
  movimentos de venda) — reforçar com uma constraint única em
  `CashMovement.orderId` quando não nulo.

## 21. Endpoints previstos

```
POST   /v1/cash/sessions               abrir sessão
GET    /v1/cash/sessions               listar sessões do tenant (paginado)
GET    /v1/cash/sessions/:id           detalhe de uma sessão (com movimentos)
GET    /v1/cash/sessions/current       sessão OPEN atual da branch, se houver
PATCH  /v1/cash/sessions/:id/close     fechar sessão
POST   /v1/cash/sessions/:id/movements registrar sangria ou suprimento
GET    /v1/cash/sessions/:id/movements listar movimentos de uma sessão
```

## 22. Telas previstas

- `/dashboard/caixa` — estado atual (aberto/fechado), saldo esperado em
  tempo real se aberto, botão abrir/fechar, atalhos para sangria/suprimento.
- `/dashboard/caixa/[id]` — detalhe de uma sessão (histórico de
  movimentos, saldo inicial/esperado/contado/diferença) — inclusive
  sessões já fechadas, para consulta.
- Modal ou seção inline para registrar sangria/suprimento (motivo +
  valor).
- Tela de fechamento com campo de contagem física e exibição clara da
  diferença antes de confirmar.

## 23. Testes críticos

- Abertura cria sessão `OPEN`; segunda tentativa de abertura com uma já
  `OPEN` falha.
- Sangria/suprimento só permitidos com sessão `OPEN`.
- Fechamento calcula `expectedClosingBalanceCents` corretamente a partir
  de abertura + suprimentos + vendas em dinheiro − sangrias.
- `differenceCents` correto (positivo, negativo e zero).
- Fechar uma sessão já `CLOSED` falha.
- Nenhum endpoint permite editar/excluir um `CashMovement` ou reabrir uma
  sessão `CLOSED`.
- Isolamento de tenant em todos os endpoints (abrir/fechar/listar/lançar
  movimento).
- Usuário sem `cash.open`/`cash.close`/permissão adequada é rejeitado.
- Venda em dinheiro do PDV gera exatamente um `CashMovement` tipo `SALE`
  (idempotência por `orderId`); venda em `PIX`/`CARD` não gera nenhum.
- Teste de **adulteração**: cliente tenta enviar
  `expectedClosingBalanceCents` ou `differenceCents` no payload de
  fechamento — backend ignora/rejeita, calcula por conta própria.

## 24. Critérios de aceite

1. abrir um caixa informando saldo inicial;
2. registrar uma sangria com motivo;
3. registrar um suprimento;
4. fazer uma venda no PDV em dinheiro e ver o valor refletido no saldo
   esperado do caixa aberto;
5. fechar o caixa informando o valor contado;
6. ver a diferença de caixa calculada corretamente;
7. não conseguir abrir um segundo caixa enquanto o primeiro está aberto;
8. não conseguir editar um movimento ou reabrir uma sessão fechada;
9. consultar o histórico de uma sessão já fechada;
10. não acessar sessões/movimentos de outro tenant.

---

# Decisões tomadas na implementação (prevalecem sobre o plano acima)

## A. Estratégia de Branch (problema resolvido antes de implementar)

Análise do código real: `Order` não tinha `branchId`; o JWT só carrega
`tenantId`; `UserBranch` existia desde a Fase 01 mas não era usado em nada;
o registro cria uma branch `MATRIZ` e vincula o OWNER a ela.

1. **Branch ativa = `branchId` explícito por requisição** (body em escritas,
   query em leituras). **Não** vai no JWT: trocar de unidade exigiria
   reemitir token, e um valor no token ficaria desatualizado se o vínculo
   `UserBranch` mudasse. O frontend guarda a seleção em `localStorage`
   (chave por usuário) **só como conveniência** — nunca é autoridade.
2. **Regra de acesso** (`BranchAccessService.assertAccess`, única fonte de
   verdade): a branch precisa pertencer ao tenant do JWT e estar `ACTIVE`
   (senão `404 BRANCH_NOT_FOUND` — não revela existência cross-tenant); e o
   usuário precisa ser OWNER/ADMIN (acesso a todas as unidades do tenant)
   **ou** ter um `UserBranch` para ela (senão `403 BRANCH_ACCESS_DENIED`).
3. **`Order.branchId` obrigatório** em todo o fluxo:
   - PDV: `branchId` no payload, validado por `assertAccess`;
   - checkout online: **branch padrão do tenant** (a `ACTIVE` mais antiga, i.e.
     a MATRIZ) via `getDefaultBranchId`. Simplificação consciente do MVP —
     o cardápio público ainda não tem seletor de unidade. Quando houver,
     basta trocar essa resolução; o modelo já suporta.
4. **Venda CASH → sessão**: dentro da transação do pedido, busca-se com
   `SELECT ... FOR UPDATE` a sessão `OPEN` de `(tenantId, branchId)` do
   próprio pedido — impossível uma venda da branch A cair no caixa da B.
5. Nova rota `GET /v1/branches/accessible` (só autenticação) alimenta o
   seletor de unidade de qualquer papel (CASHIER não tem `restaurant.read`).

## B. Concorrência (proteção real, não `if (!open) create()`)

- **Abertura**: transação que primeiro trava a **linha da branch**
  (`SELECT id FROM branches WHERE id = $1 FOR UPDATE`), depois checa se há
  sessão OPEN e cria. Duas aberturas simultâneas serializam; a segunda, ao
  obter o lock, já enxerga a sessão commitada (READ COMMITTED relê) e recebe
  `409 CASH_SESSION_ALREADY_OPEN`.
- **Defesa em profundidade no banco**: índice único **parcial**
  `("tenantId","branchId") WHERE status = 'OPEN'` em
  `prisma/sql/cash_register_constraints.sql` (Prisma não expressa índice
  parcial no schema). Aplicado com `pnpm db:constraints` **após**
  `pnpm db:migrate`. Uma violação (P2002) também vira 409.
- **Fechamento / movimento / venda CASH**: todos travam a **linha da sessão**
  (`FOR UPDATE`) e re-checam `status = 'OPEN'` dentro da transação. Logo:
  dois fechamentos simultâneos → um fecha, o outro recebe
  `409 CASH_SESSION_ALREADY_CLOSED`; um movimento/venda concorrente com o
  fechamento ou entra antes (e é contado no saldo esperado) ou falha depois —
  nunca "entra num caixa já fechado". Ordem de locks sem ciclo (abertura
  trava branch; o resto trava sessão), sem risco de deadlock entre eles.

## C. Idempotência e imutabilidade

- `CashMovement.orderId` é `@unique` (nulo permitido várias vezes no
  Postgres): um pedido **nunca** gera dois SALE — garantido pelo banco.
- Venda CASH do PDV: `Order` + `CashMovement SALE` na **mesma transação**
  (`OrderCreationService`) — não existe Order CASH de balcão sem SALE, nem
  SALE sem Order.
- Imutabilidade em duas camadas: nenhuma rota de update/delete de movimento
  nem de reabertura de sessão; **e** trigger `cash_movements_immutable`
  (mesmo arquivo SQL) bloqueia UPDATE/DELETE direto no banco. Efeito
  colateral documentado: excluir um tenant com movimentos de caixa falha
  (cascade bloqueado) — aceitável, exclusão de tenant não é feature do MVP e
  dados financeiros não devem sumir em cascata.
- Sangria/suprimento **não** são deduplicados automaticamente (dois cliques
  = dois lançamentos reais); a UI desabilita o botão durante o envio.

## D. PDV sem caixa aberto

Política (a) do plano, implementada: venda `CASH` no PDV sem sessão OPEN na
branch → `409 CASH_REGISTER_NOT_OPEN`, **nada é persistido**. `PIX`/`CARD`
nunca geram movimento. Pedidos **online** em CASH (pagamento na
entrega/retirada) também **não** tocam o caixa nesta fase — só vendas de
balcão.

## E. Permissões efetivas

`cash.read`, `cash.open`, `cash.close`, `cash.movement.create` (nova).
OWNER/ADMIN: todas. MANAGER e CASHIER: as quatro. Demais papéis: nenhuma.

## F. Contrato de valores

Toda a API do caixa usa **centavos inteiros** nos dois sentidos
(`openingBalanceCents`, `amountCents`, `countedClosingBalanceCents`, ...).
`expectedClosingBalanceCents`/`differenceCents` são calculados só no backend
(`cash-calculations.ts`, funções puras) e **rejeitados (400)** se enviados.
No frontend, a conversão "R$ 10,50" → 1050 é feita por parsing de string
(`parseBRLToCents`), sem aritmética de ponto flutuante.
