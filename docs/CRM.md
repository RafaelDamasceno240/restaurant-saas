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

- `ordersCount`, `totalSpentCents`, `averageTicketCents` (arredondado ao centavo, meio para cima), `lastOrderAt`: **todos os pedidos exceto `CANCELLED`**.
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

`/dashboard/clientes` (menu "Clientes", para OWNER/ADMIN/MANAGER/CASHIER): abas Ativos/Inativos/Todos com contagem, busca (valor adiado com `useDeferredValue`), tabela (cliente + telefone formatado, e-mail, pedidos, total gasto, última compra, situação), paginação, estados de carregando, erro com "Tentar novamente" e vazio (com e sem filtros). "Novo cliente" e edição em diálogo (nome, telefone, e-mail e CPF são validados antes de enviar; o servidor valida de novo); detalhe com os quatro indicadores e o histórico paginado de pedidos; inativar/reativar (gerência). Guard síncrono contra clique duplo em salvar e inativar/reativar.

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
