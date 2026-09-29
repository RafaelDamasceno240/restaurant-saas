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
| `audit`    | escrita centralizada de `AuditLog`, best-effort                |
| `health`   | `/health`, `/health/live`, `/health/ready`                     |
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

Nenhuma interface `PaymentProvider`/`FiscalProvider`/`MessagingProvider`/etc.
foi criada ainda — o prompt da Fase 01 pede explicitamente para não antecipar
abstrações vazias. Quando a Fase 11 (Pagamentos) ou 12 (NFC-e) chegar, essas
interfaces devem nascer junto com o primeiro provider real.
