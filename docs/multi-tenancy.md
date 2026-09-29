# Multi-tenancy

## Modelo

```
Tenant
  └── Branch (unidade)
User → pertence a exatamente um Tenant (Fase 01)
User → UserBranch → pode acessar 0..N Branches do seu Tenant
```

## Regra de ouro

**O backend nunca aceita `tenantId` vindo do cliente** (nem em `body`, nem em
query string, nem em parâmetro de rota) para decidir de qual tenant ler ou
escrever dados. O único lugar onde `tenantId` é decidido é dentro do payload
do access token, validado por assinatura (`JwtStrategy`), e exposto aos
controllers via `@CurrentUser()` → `AuthenticatedRequestUser.tenantId`.

Todo service que lê/escreve dados de tenant recebe esse `tenantId` como
parâmetro explícito e o usa em toda query (`where: { tenantId, ... }`).
Exemplo (`UsersService.findOneForTenant`):

```ts
const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId } });
if (!user) throw new NotFoundException(...); // mesmo erro p/ "não existe" e "é de outro tenant"
```

Retornar **o mesmo `404`** nos dois casos (recurso inexistente vs. recurso de
outro tenant) evita que a API revele, por diferença de status code, que um
determinado ID pertence a outro restaurante.

## Onde isso é testado

`apps/api/test/tenant-isolation.e2e-spec.ts` é o teste obrigatório da Fase
01: cria dois tenants (A e B) via `/auth/register` e garante que o token de A
nunca consegue ler usuário, branch ou qualquer dado de B.

## Extensão futura

Como `UserRole` já carrega `tenantId` (mesmo sendo redundante com
`User.tenantId` hoje), oferecer múltiplos tenants por usuário no futuro não
exige alterar esse modelo — apenas remover a constraint implícita de
"1 user = 1 tenant" na camada de aplicação.
