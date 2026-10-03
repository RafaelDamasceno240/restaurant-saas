# CRM — Clientes (Fase 11, fatia 1)

Estado real implementado em 2026-09-30. Esta fatia entrega **somente a base de clientes**: cadastro, busca, histórico de pedidos e métricas derivadas. Não há cashback, fidelidade, cupons, campanhas, automações, WhatsApp nem segmentação.

## Modelo

`Customer` (tabela `customers`), **por tenant** (sem `branchId`: o cliente pode comprar em qualquer unidade).

| Campo | Regra |
|---|---|
| `tenantId` | sempre do token; nunca de body/query/rota |
| `name` | 2 a 120 caracteres (também por `CHECK` no banco) |
| `phone` | **obrigatório**, guardado só com dígitos (8 a 15). Um número brasileiro digitado com país (`55` + DDD + 8/9 dígitos = 12 ou 13 dígitos) é reduzido ao número nacional: `+55 (11) 98765-4321` e `11987654321` são o mesmo telefone. Nenhuma outra regra é adivinhada (sem tabela de DDD nem checagem de prefixo) |
| `email` | opcional, minúsculo, validado como e-mail. **Não é único** (famílias e empresas compartilham) |
| `cpf` | opcional, 11 dígitos com **dígitos verificadores válidos**; sequências repetidas (`000.000.000-00`) são recusadas |
| `notes` | opcional, até 500 caracteres |
| `active` | inativação em vez de exclusão: o histórico mantém o vínculo |

**Unicidade (índices únicos parciais, em SQL):**
- `(tenantId, phone) WHERE active` — um cliente **ativo** por telefone; um inativo pode repetir o telefone, e reativar re-verifica (409 se já há ativo com ele).
- `(tenantId, cpf) WHERE cpf IS NOT NULL` — um CPF identifica uma pessoa por tenant (vale também para inativos: reative em vez de recadastrar).
- A mesma pessoa/telefone pode existir em **outro tenant**.
- A API faz a verificação amigável (409 com `details.customerId` do cliente existente, do mesmo tenant) e o índice garante sob concorrência (10 cadastros simultâneos do mesmo telefone = 1 cliente).

`CHECK`s no banco: telefone só dígitos (8–15), CPF 11 dígitos, e-mail minúsculo, nome não vazio, observações ≤ 500.

## Vínculo com pedidos

- `orders.customerId` **nullable**, FK `ON DELETE SET NULL`, índice `(tenantId, customerId, createdAt)`. Migration `20261001100000_customers`: aditiva, sem backfill — **todo pedido existente fica com `customerId = NULL`** e com o snapshot `customerName/customerPhone` exatamente como estava.
- O snapshot do pedido **nunca é reescrito** pelo CRM (editar ou apagar o cliente não muda o pedido; apagar a linha do cliente só zera o vínculo).
- Pedido sem cliente, cliente sem pedidos e cliente com vários pedidos são todos válidos. Nada financeiro muda (subtotal, taxa e total idênticos com ou sem vínculo — testado).
- **Quem vincula nesta fatia: só o PDV**, com `customerId` opcional em `POST /pos/orders`. O servidor exige `customers.read`, busca o cliente **dentro do tenant do chamador** (outro tenant = 404 `CUSTOMER_NOT_FOUND`), recusa inativo (409 `CUSTOMER_INACTIVE`) e copia nome/telefone do cliente para o snapshot **apenas se nada foi digitado** no balcão. A idempotência do pedido considera o cliente (mesma chave com outro cliente = 409 `IDEMPOTENCY_KEY_REUSED`).
- O **checkout público não conhece `Customer`**: não aceita `customerId`, não cria nem consulta clientes e não expõe nada do cadastro. Pedidos antigos **não** são atribuídos a clientes por coincidência de telefone.

## Endpoints (todos autenticados)

| Método e rota | Permissão | Descrição |
|---|---|---|
| `GET /v1/customers?search=&status=active\|inactive\|all&page=&pageSize=` | `customers.read` | lista paginada (padrão: ativos), nome ↑ com `id` como desempate; `summary {active, inactive}` respeita a busca; cada linha traz `ordersCount`, `totalSpentCents`, `lastOrderAt` (uma única consulta agrupada para a página) |
| `POST /v1/customers` | `customers.create` | cadastra |
| `GET /v1/customers/:id` | `customers.read` | registro completo + `metrics` |
| `PATCH /v1/customers/:id` | `customers.update` | edita só o que foi enviado; `email`/`cpf`/`notes` aceitam `null`/`""` para limpar; `active=false` inativa, `true` reativa; patch sem mudança = 200 sem escrita nem auditoria |
| `GET /v1/customers/:id/orders?branchId=&status=&page=&pageSize=` | `customers.read` | histórico, mais novo primeiro |

`pageSize` ≤ 100, `page` ≤ 1000 (400 acima disso). Valores monetários do CRM em **centavos**. A busca olha nome, e-mail, telefone e CPF (dígitos só a partir de 3, para "11" não casar metade da base); `%`, `_` e `\` são texto comum.

A lista **não devolve CPF nem observações** (minimização de dados); o detalhe devolve.

## Métricas (derivadas, nada é armazenado)

Calculadas por `groupBy status` sobre os pedidos do cliente:

- `ordersCount`, `totalSpentCents`, `averageTicketCents` (arredondado ao centavo, meio para cima), `firstOrderAt` (pedido mais antigo) e `lastOrderAt` (mais recente): **todos os pedidos exceto `CANCELLED`**. `firstOrderAt` só existe no detalhe (`GET /customers/:id`), vem do mesmo `groupBy` (`_min`/`_max` de `createdAt`), sem consulta extra; é `null` sem pedidos válidos.
- `cancelledCount`: pedidos cancelados, mostrados à parte e fora dos valores; o histórico lista os cancelados com `counted: false`.

**Decisão:** é a única regra de "venda" por pedido que o sistema já tem — o dashboard (`use-dashboard-stats.ts`) conta todos os pedidos não cancelados —, então o CRM não contradiz o que o gerente vê na visão geral. Um pedido ainda em andamento conta desde que existe; uma entrega que falhou mantém o pedido `READY` (Fase 10) e continua contando até ser cancelado. O caixa não é usado como fonte: só o PDV em dinheiro gera movimento de caixa.

## Permissões e isolamento

| Permissão | OWNER | ADMIN | MANAGER | CASHIER | demais |
|---|---|---|---|---|---|
| `customers.read` | ✔ | ✔ | ✔ | ✔ | — |
| `customers.create` | ✔ | ✔ | ✔ | ✔ | — |
| `customers.update` (editar, inativar, reativar) | ✔ | ✔ | ✔ | — | — |

O CASHIER lê e cadastra porque o PDV precisa encontrar/criar o cliente no balcão. As permissões entram pelo **seed** (`pnpm db:seed`) e os usuários precisam entrar de novo.

- **Tenant:** toda consulta filtra pelo tenant do token; cliente de outro tenant = 404 (nada vaza); `tenantId` no corpo é rejeitado (400).
- **Filial:** o cliente é do tenant, mas o **histórico e as métricas** só consideram as unidades que o usuário acessa (OWNER/ADMIN: todas). Um gerente da filial 2 vê o mesmo cliente medido só nos pedidos da filial 2; `branchId` fora do seu acesso = 403. O PDV continua validando a filial do usuário.
- **Auditoria** (atômica, `recordTx`): `CUSTOMER_CREATED`, `CUSTOMER_UPDATED`, `CUSTOMER_DEACTIVATED`, `CUSTOMER_REACTIVATED`. O registro guarda **quais campos** mudaram, nunca telefone, e-mail, CPF ou nome (não há dado pessoal na trilha nem em logs). Se a auditoria falhar, a operação sofre rollback (testado com trigger real).

## Frontend

`/dashboard/clientes` (menu "Clientes", para OWNER/ADMIN/MANAGER/CASHIER): abas Ativos/Inativos/Todos com contagem, busca (valor adiado com `useDeferredValue`), tabela (cliente + telefone formatado, e-mail, pedidos, total gasto, última compra, situação), paginação, estados de carregando, erro com "Tentar novamente" e vazio (com e sem filtros). "Novo cliente" e edição em diálogo (nome, telefone, e-mail e CPF são validados antes de enviar; o servidor valida de novo); detalhe com os cinco indicadores (pedidos, total gasto, ticket médio, primeira e última compra) e o histórico paginado de pedidos; inativar/reativar (gerência). Guard síncrono contra clique duplo em salvar e inativar/reativar.

## Limitações desta fatia

- O vínculo com o pedido só existe no **PDV** (a API aceita `customerId`; a **tela do PDV ainda não tem seletor de cliente**). Checkout público, comanda/mesa e delivery não vinculam.
- Sem importação, sem mesclar duplicados, sem exclusão, sem endereços de entrega no cadastro.
- Sem segmentação, cashback, fidelidade, cupons ou campanhas (a base foi pensada para recebê-los: `customerId` já está no pedido).
- Métricas por consulta agregada (sem tabela de resumo): suficiente para o volume de uma base de restaurante; revisar se uma base tiver centenas de milhares de pedidos por cliente.
- Telefone aceita qualquer número de 8 a 15 dígitos; não há validação de DDD/celular.

## Deploy

1. `pnpm --filter api exec prisma migrate deploy` (migration `20261001100000_customers`, aditiva).
2. `pnpm db:seed` e novo login dos usuários.
3. Nada a migrar nos pedidos existentes.


---

# CRM — Cupons e descontos (Fase 11, fatia 2)

Esta fatia entrega a **fundação de cupons**: cadastro administrativo, validação e cálculo do desconto no backend, integração ao fluxo de pedidos existente (PDV e checkout público) e prévia somente-leitura. **Não** há cashback, fidelidade, pontos, campanhas automáticas, WhatsApp, IA, segmentação nem restrição por produto/categoria.

## Regra de ouro

O cupom **não é uma funcionalidade do frontend**. A tela só envia o **código**. O servidor decide e recalcula: existência, tenant, ativo, janela de validade, mínimo, limites, filial, cliente, valor do desconto e total final. Nada disso é aceito do cliente (`discount`, `total`, preço, `tenantId`, `couponId` são rejeitados no PDV e ignorados no checkout público).

## Modelo

`Coupon` (`coupons`), **por tenant**, e `CouponRedemption` (`coupon_redemptions`, a trilha de uso). `Order` ganhou `discountCents` (padrão 0), `couponId` (FK `SET NULL`) e `couponCode` (snapshot do código no momento do pedido).

| Campo do cupom | Regra |
|---|---|
| `code` | forma canônica: `trim` + maiúsculas, só `A-Z 0-9 - _`, 3 a 32 caracteres (também por `CHECK`). **Imutável** depois de criado |
| `discountType` / `value` | `PERCENTAGE`: percentual inteiro de 1 a 100. `FIXED`: centavos, no mínimo 1 |
| `minOrderCents` | subtotal mínimo dos itens, **antes do desconto** |
| `maxDiscountCents` | teto do desconto, **somente** para `PERCENTAGE` |
| `startsAt` / `endsAt` | janela `[startsAt, endsAt)`: vale a partir de `startsAt` e acaba em `endsAt`; ambos opcionais |
| `usageLimit` / `usageCount` | limite global de **pedidos**; `usageCount` só muda dentro da transação do pedido |
| `perCustomerLimit` | limite por cliente; **exige cliente vinculado** (ver abaixo) |
| `branchId` | opcional: restringe a uma unidade; vazio = todas. Imutável |
| `active` | ativar/desativar por endpoint próprio; **não há exclusão** |

Todo dinheiro é **inteiro em centavos**. Pedido: `totalCents = subtotalCents - discountCents + deliveryFeeCents`, garantido também por `CHECK` no banco, junto com `0 <= discountCents <= subtotalCents`.

## Unicidade do código

Índice único **parcial** `coupons_tenantId_code_active_key` em `(tenantId, code) WHERE active = true`. Como o código é canônico (`CHECK`), o banco compara exatamente o que a aplicação compara. Resultado:

- `promo10`, `PROMO10` e ` PROMO10 ` são o mesmo cupom;
- nunca existem dois ativos com o mesmo código no mesmo tenant (inclusive com requisições simultâneas: 10 criações paralelas deixam exatamente 1);
- é possível desativar `PROMO10` e criar outro `PROMO10` ativo; reativar o antigo enquanto o novo estiver ativo dá `409 COUPON_CODE_TAKEN`;
- o mesmo código pode existir em tenants diferentes;
- a resolução de um código considera **somente o registro ativo**.

## Cálculo

Sobre o **subtotal dos itens**, nunca sobre a taxa de entrega:

- `PERCENTAGE`: `floor(subtotal × value / 100)`, depois limitado por `maxDiscountCents` (arredonda **para baixo**: o cliente nunca ganha mais que o percentual exato);
- `FIXED`: `value`;
- em ambos, nunca acima do subtotal; um cupom que descontaria 0 é recusado (`COUPON_NO_DISCOUNT`) em vez de gastar um uso;
- o pedido mínimo da **entrega** e o mínimo do cupom são avaliados sobre o subtotal antes do desconto.

A calculadora e a ordem das regras (inativo, ainda não iniciado, expirado, outra unidade, mínimo, cliente exigido, limite global, limite por cliente, sem desconto) são funções puras em `coupon-calculations.ts`, usadas pelo pedido e pela prévia: não há duas implementações.

## Integração com pedidos (sem fluxo paralelo)

`OrderCreationService` continua sendo o único lugar que cria pedidos. O PDV e o checkout público só repassam `couponCode`:

1. os itens são precificados no servidor (`priceItems`, também usado pela prévia);
2. dentro da transação do pedido, **depois** do lock do caixa e **antes** de criar o pedido, o cupom é resolvido (`applyInTx`);
3. o pedido é criado com `discountCents`, `couponId`, `couponCode`; em seguida `consumeInTx` incrementa o uso e grava o resgate, **na mesma transação**. Qualquer falha reverte tudo, inclusive o uso;
4. a venda em dinheiro registra no caixa o total **com desconto** (é o que entra na gaveta).

No PDV, usar cupom exige `coupons.apply` (não decorre de `pos.create`). Pedidos de mesa/comanda não usam cupom.

## Concorrência

Decisão: **lock pessimista de linha**. `applyInTx` faz `SELECT ... FOR UPDATE` no cupom ativo, relê e reavalia todas as regras **na linha travada**, e só então consome. Assim o limite global e o limite por cliente são verificados e alterados por uma transação de cada vez para o mesmo cupom. Ler `usageCount` e incrementar em duas operações soltas deixaria dois pedidos passarem juntos. `CHECK usageCount <= usageLimit` é apenas a última barreira, nunca a regra.

- Pedidos com cupons diferentes (ou sem cupom) não esperam uns pelos outros.
- Ordem fixa de locks: sessão de caixa (venda em dinheiro) → cupom. Não há ciclo, logo não há deadlock.
- Editar o cupom (`PATCH`, ativar/desativar) trava a mesma linha; baixar `usageLimit` abaixo do já usado é recusado (`COUPON_USAGE_LIMIT_BELOW_USED`).

## Idempotência

Reaproveita o mecanismo do pedido (`idempotencyKey`). O cupom entra na assinatura da requisição:

- repetir a mesma requisição devolve o **mesmo pedido** e **não consome** outro uso (o replay acontece antes de qualquer lock);
- a mesma chave com outro cupom, ou com e sem cupom, é `409 IDEMPOTENCY_KEY_REUSED`;
- uma duplicata **simultânea** perde a corrida de duas formas (colide na chave ao inserir, ou espera o lock do cupom e encontra o uso já tomado pelo gêmeo vencedor); nos dois casos recebe o pedido original, e nunca um falso "cupom esgotado".

## Prévia (somente leitura)

`POST /v1/pos/orders/coupon-preview` (autenticado, `coupons.apply`) e `POST /v1/public/orders/coupon-preview` (anônimo, limitado a 20 req/min). Devolvem `code`, `discountType`, `subtotalCents`, `discountCents`, `subtotalAfterDiscountCents`. Mesma precificação e mesmas regras do pedido, mas **sem** incrementar uso, criar resgate, criar pedido, reservar ou deixar lock. Pode ficar desatualizada entre a prévia e a confirmação (cupom desativado, esgotado, carrinho alterado): o pedido revalida tudo na transação, e isso é comportamento normal. A tela só mostra o desconto da prévia enquanto o carrinho for exatamente o mesmo.

## Erros e privacidade

Regras de negócio usam o padrão do projeto (`400` com `code`; `409` para limites). No **PDV** (equipe do tenant) o motivo é específico: `COUPON_NOT_FOUND`, `COUPON_NOT_STARTED`, `COUPON_EXPIRED`, `COUPON_WRONG_BRANCH`, `COUPON_MIN_ORDER_NOT_MET`, `COUPON_CUSTOMER_REQUIRED`, `COUPON_USAGE_LIMIT_REACHED`, `COUPON_CUSTOMER_LIMIT_REACHED`, `COUPON_NO_DISCOUNT`. No **checkout público** toda recusa é a mesma resposta (`400 COUPON_INVALID`), para ninguém enumerar códigos do restaurante. Cupom de outro tenant é igual a cupom inexistente.

## Endpoints

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /v1/coupons?search=&status=active\|inactive\|all&page=&pageSize=` | `coupons.read` | lista paginada (padrão: ativos), mais novos primeiro com `id` de desempate; `summary {active, inactive}`; cada cupom traz `availability` derivada (`AVAILABLE`, `SCHEDULED`, `EXPIRED`, `EXHAUSTED`, `INACTIVE`) |
| `GET /v1/coupons/:id` | `coupons.read` | detalhe |
| `POST /v1/coupons` | `coupons.create` | cria (código normalizado; `409 COUPON_CODE_TAKEN` se já houver ativo) |
| `PATCH /v1/coupons/:id` | `coupons.update` | edita regras; `code`, `branchId`, `active`, `usageCount` e `tenantId` são rejeitados (`400`) |
| `POST /v1/coupons/:id/activate` / `deactivate` | `coupons.update` | idempotentes |
| `POST /v1/pos/orders` (campo `couponCode`) | `pos.create` + `coupons.apply` | aplica o cupom na venda |
| `POST /v1/public/orders` (campo `couponCode`) | público | aplica o cupom no pedido online |
| `POST /v1/pos/orders/coupon-preview`, `POST /v1/public/orders/coupon-preview` | `coupons.apply` / público | prévia somente-leitura |

Não existe `DELETE`: cupons usados mantêm o histórico. As respostas de pedido ganharam `discount` e `couponCode`.

## Permissões e isolamento

| Papel | Permissões de cupom |
|---|---|
| OWNER, ADMIN | `coupons.read`, `create`, `update`, `apply` |
| MANAGER | `coupons.read`, `create`, `update`, `apply` |
| CASHIER | **somente** `coupons.apply` (aplica no PDV, não administra) |
| WAITER, KITCHEN, DELIVERY, VIEWER | nenhuma |

- Tenant sempre do token; cupom, cliente ou unidade de outro tenant é "não encontrado".
- **Filial (administração):** OWNER/ADMIN gerenciam todos; os demais veem os cupons do tenant inteiro e os das suas unidades, e só criam/alteram cupons das suas unidades (`403 COUPON_BRANCH_FORBIDDEN` para os demais). No pedido, um cupom restrito a uma unidade só vale nela.
- **Limite por cliente:** só com `customerId` válido (mesmo tenant, ativo): hoje o PDV via API. O checkout público **nunca** identifica cliente (telefone não substitui `customerId`), então cupom com `perCustomerLimit` é sempre recusado ali.
- Auditoria atômica (`recordTx`): `COUPON_CREATED/UPDATED/ACTIVATED/DEACTIVATED`, com nomes de campos e código, sem texto livre nem dado pessoal; `ORDER_CREATED` passa a registrar `discountCents` e `couponCode`.

## Frontend

`/dashboard/cupons` (menu "Cupons", OWNER/ADMIN/MANAGER): abas Ativos/Inativos/Todos com contagem, busca por código, tabela (código, desconto, validade, usos, situação), paginação, estados de carregando, erro com "Tentar novamente" e vazio (com e sem filtros), criar/editar em diálogo (código e unidade só na criação), ativar/desativar. Guard síncrono contra clique duplo. O PDV e o checkout público ganharam o campo de cupom com "Aplicar" (prévia); o total mostrado é só visual, e o pedido recalcula tudo no servidor. Detalhe do pedido e confirmação pública mostram a linha de desconto.

## Limitações conhecidas

- **Cancelar o pedido não devolve a utilização do cupom.** Pedidos cancelados contam no limite global e no limite por cliente (decisão desta fatia: nunca ultrapassa o limite, no máximo fica conservador).
- Cupom com limite por cliente só é exercitável pela API do PDV: a tela do PDV ainda não tem seletor de cliente.
- Um cupom por pedido; sem restrição por produto/categoria; sem cupom em mesa/comanda; sem exclusão física.
- O lock por cupom serializa os pedidos que usam **o mesmo** cupom (aceito).
- A busca da lista usa `contains` sem índice trigram.

## Deploy

Migration `20261002100000_coupons` (aditiva): `prisma migrate deploy`. Ela adiciona 3 `CHECK`s em `orders`, que validam as linhas existentes sob lock curto da tabela. As permissões `coupons.*` entram pelo seed: **rode `pnpm db:seed` e faça login de novo**, senão MANAGER e CASHIER não terão acesso.
