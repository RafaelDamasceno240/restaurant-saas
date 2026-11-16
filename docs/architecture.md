# Arquitetura

## Estilo

Monólito modular, não microsserviços. O backend (`apps/api`) é um único
processo NestJS organizado por domínio, para permitir extrair um módulo como
serviço independente no futuro sem reescrever os demais.

## Módulos do backend

| Módulo     | Responsabilidade                                             |
|------------|----------------------------------------------------------------|
| `auth`     | register/login/refresh/logout/me, emissão e rotação de tokens |
| `users`    | leitura de usuários — sempre filtrada pelo tenant autenticado |
| `tenants`  | leitura do tenant do usuário autenticado                       |
| `branches` | leitura de unidades do tenant autenticado                      |
| `audit`    | escrita centralizada de `AuditLog`: `record` (melhor esforço, depois do commit) e `recordTx` (dentro da transação da operação, usada pelos ledgers) |
| `health`   | `/health`, `/health/live`, `/health/ready`                     |
| `categories`, `products` | cardápio administrativo (preço em centavos no banco)  |
| `public-menu` | cardápio público por slug, sem autenticação                |
| `public-orders` | checkout público e acompanhamento do pedido              |
| `order-creation` | criação de pedido compartilhada (online, PDV, comanda): totais, caixa e estoque na mesma transação |
| `orders`   | painel de pedidos, KDS e transições de status                  |
| `pos`      | pedido de balcão (PDV)                                         |
| `payments` | registro interno do pagamento (`provider = INTERNAL`)          |
| `cash`     | sessões de caixa, suprimento, sangria, fechamento              |
| `tables`, `tabs` | mesas e comandas, checkout idempotente da comanda        |
| `inventory` | insumos, saldos, movimentações, fichas técnicas, inventário   |
| `purchases` | fornecedores e compras de estoque (rascunho, recebimento, cancelamento) |
| `delivery` | taxa e pedido mínimo por unidade, despacho, falha, reentrega, entregador |
| `customers` | cadastro de clientes, histórico, métricas, segmentos e vínculo com pedidos |
| `coupons`  | cupons de desconto, validação e consumo dentro da transação do pedido |
| `loyalty`  | programa de pontos: ledger, recompensas, resgate, ajuste e estorno |
| `cashback` | saldo de cashback em centavos: ledger, uso em vendas, devolução, expiração |
| `receivables` | fiado / contas a receber: limite, parcelas, recebimentos, estornos |
| `order-effects` | ponto único do que acontece com os benefícios quando um pedido é concluído, cancelado ou muda de cliente |
| `reports`  | relatórios operacionais somente leitura (vendas, produtos, clientes, estoque, delivery, caixa) |
| `redis`    | cliente Redis global (lista de sessões revogadas)             |
| `prisma`   | `PrismaService` global, injetado nos demais módulos            |
| `common`   | guards, decorators, filtro de exceções, middleware, logger     |

## Requisição autenticada — fluxo

```
Request → RequestIdMiddleware → JwtAuthGuard → RolesGuard → PermissionsGuard
        → ThrottlerGuard → Controller → Service (filtra por tenantId do JWT)
```

`JwtAuthGuard` é global (`APP_GUARD`); rotas públicas usam `@Public()`
explicitamente (register, login, refresh, health). Isso implementa
"seguro por padrão": esquecer de proteger uma rota nova é impossível — é
preciso decidir ativamente torná-la pública.

## Transação do pedido e ordem de travas

Criar, concluir e cancelar um pedido movem vários registros financeiros (caixa, cupom, cashback, fiado, pontos, estoque) em **uma única transação**: ou tudo é gravado, ou nada. Cada registro é protegido por trava de linha (`SELECT ... FOR UPDATE`), e todos os fluxos pegam as travas **na mesma ordem**:

```
linha do pedido → sessão de caixa → cupom → conta de cashback → conta de crédito (fiado) → conta de fidelidade → saldos de estoque
```

O cancelamento só trava a sessão de caixa quando o pedido tem uma venda em dinheiro a devolver (movimento `SALE_REFUND`, na sessão aberta da unidade; sem caixa aberto o cancelamento é recusado). A entrega (`deliveries`) é travada depois da sessão de caixa. Desde 2026-10-23 (correção B3 do piloto), concluir um pedido pago em dinheiro que ainda não entrou no caixa (online: `COMPLETED` ou `DELIVERED`) também trava a sessão de caixa, no mesmo lugar da ordem (pedido -> sessão de caixa -> entrega), e grava o `SALE` na mesma transação. Ao fazer um pedido `PENDING`, os saldos de estoque dos insumos dele são travados no fim da transação (correção B2), mantendo o estoque como última trava.

A ordem única é o que impede deadlock entre, por exemplo, o fechamento de uma mesa e o cancelamento de outro pedido do mesmo cliente. Um fluxo novo que trave mais de um desses registros deve seguir essa ordem. `test/financial-chain.e2e-spec.ts` exercita os módulos juntos, inclusive esse cenário.

Dinheiro é sempre `Int` em centavos; o servidor recalcula preço, desconto, taxa e total e nunca confia em valor vindo do cliente.

## Configuração

Todas as variáveis de ambiente são validadas com Zod (`src/config/env.validation.ts`)
no bootstrap do `ConfigModule`. Se uma variável obrigatória estiver ausente ou
malformada, a aplicação lança um erro síncrono e o processo não sobe — não há
como rodar com configuração inválida "silenciosamente".

## Padrão de erros

Todo erro passa pelo `GlobalExceptionFilter` e sai no formato:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "...",
  "requestId": "...",
  "details": [...]
}
```

Erros 5xx nunca vazam stack trace ao cliente (apenas nos logs do servidor).

## Logging

`nestjs-pino` com redação automática de `authorization`, cookies e campos de
senha/token. Cada log carrega o `requestId` gerado por `RequestIdMiddleware`
(aceita um `x-request-id` do cliente, mas gera um novo se ausente ou inválido).

## Docker / infraestrutura local

`docker-compose.yml` sobe PostgreSQL e Redis com healthcheck. A API e o
frontend rodam fora de container em desenvolvimento (via `pnpm dev`); a
containerização das próprias apps fica preparada para uma fase futura de
deploy, mas não foi feita agora para não adicionar complexidade sem uso
imediato.

## Preparação para integrações futuras

Nenhuma interface de provedor de pagamento, fiscal ou de mensageria existe
(o enum `PaymentProvider` só tem `INTERNAL`) — a Fase 01 pediu explicitamente
para não antecipar abstrações vazias. Quando um gateway de pagamento ou a NFC-e forem implementados, essas
interfaces devem nascer junto com o primeiro provider real.
