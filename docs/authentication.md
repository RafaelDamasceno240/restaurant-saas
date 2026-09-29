# Autenticação e segurança

## Hash de senha

Argon2 (`argon2` npm package), não texto puro, não bcrypt/md5/sha.

## Tokens

- **Access token**: JWT curto (`JWT_ACCESS_EXPIRES_IN`, padrão `15m`),
  assinado com `JWT_ACCESS_SECRET`. Contém `sub` (userId), `tenantId`,
  `email`, `roles` e `permissions` já resolvidos — evita uma consulta ao
  banco a cada requisição só para saber o que o usuário pode fazer.
  Devolvido no **corpo** da resposta; o frontend guarda em memória
  (React state), nunca em `localStorage`.
- **Refresh token**: JWT mais longo (`JWT_REFRESH_EXPIRES_IN`, padrão `7d`),
  assinado com `JWT_REFRESH_SECRET`, contém apenas `sub` e um `jti` aleatório.
  Entregue como cookie `httpOnly`, `sameSite=lax`, `secure` em produção,
  com `Path=/` (ver "Escopo do cookie de refresh" abaixo — **não** é
  restrito a `/auth`, isso quebraria o refresh e o middleware do frontend).
  O hash SHA-256 do token (nunca o token em si) é gravado em
  `refresh_tokens.tokenHash` para permitir revogação/rotação.

## Rotação e revogação

`POST /auth/refresh` é **de uso único**: ao validar o cookie, o token antigo
é marcado `revokedAt` e um novo par é emitido (`replacedBy` aponta para o
hash do novo token). Reutilizar um refresh token já trocado resulta em `401`.
`POST /auth/logout` revoga o refresh token atual e limpa o cookie.

## Por que não access token em cookie também?

Manter o access token fora de cookies evita CSRF nas rotas que ele protege
(ele só é enviado explicitamente via header `Authorization`, nunca
automaticamente pelo browser). O refresh token, por sua vez, só é aceito na
rota `/auth/refresh` — que valida o token contra o hash gravado no banco e o
revoga em caso de reuso — e teria uso limitado mesmo se exfiltrado via um XSS
que também comprometesse `httpOnly` — o que já não é o modelo de ameaça que
cookies `httpOnly` cobrem, mas reduz a superfície. (O `Path=/` do cookie, ver
seção seguinte, amplia onde o *navegador* o envia automaticamente — não amplia
quais rotas da API o *aceitam*: isso continua restrito a `/auth/refresh`.)

## Escopo do cookie de refresh

O cookie `refresh_token` é criado com `Path=/` — não `/auth` e não
`/v1/auth`. Isso não é um descuido: é a única configuração que funciona dado
como a arquitetura desta fase está montada.

**O bug que isso corrige:** o path de um cookie é comparado por
prefixo puro contra o path da URL de destino de cada requisição — nada mais.
Duas coisas dependem de enxergar esse cookie:

1. `POST /v1/auth/refresh` — o path real inclui o prefixo de versão
   (`app.enableVersioning(...)` em `main.ts`). Um cookie com `Path=/auth`
   nunca seria enviado para `/v1/auth/refresh`, porque essa string não
   começa com `/auth`. O refresh, na prática, nunca funcionaria num
   navegador real (só "funcionava" nos testes e2e porque `supertest`
   injeta o header `Cookie` manualmente, ignorando path matching).
2. `middleware.ts` do frontend (`apps/web`) — lê esse mesmo cookie em
   requisições para `/dashboard`, que rodam num servidor **diferente**
   (porta diferente em dev, domínio diferente em produção). `/dashboard`
   nunca é prefixado por `/auth` nem por `/v1/auth`, então esse cookie
   também nunca apareceria ali.

`/` é o único valor que é prefixo de ambos ao mesmo tempo. Com `Path=/`, o
cookie é enviado em toda requisição para o host que o emitiu — inclusive
`/v1/auth/refresh` — e, no ambiente local (mesmo host `localhost`, portas
diferentes), também aparece nas requisições feitas ao Next.js.

**Por que isso funciona em dev mas é uma limitação para produção:** o
matching de cookie por `Domain` ignora a porta, mas **não** ignora o host.
`localhost:3000` e `localhost:4000` compartilham cookies porque são o mesmo
host; `app.exemplo.com` e `api.exemplo.com` são hosts diferentes e
**nunca** compartilhariam esse cookie, não importa o `Path` escolhido. Antes
de qualquer deploy real, isso precisa de uma das soluções abaixo (nenhuma
implementada nesta fase, por estar fora do escopo de fundação):

- servir frontend e API sob o mesmo domínio-raiz via proxy reverso (ex.:
  `app.exemplo.com` e `app.exemplo.com/api`, com `Domain` não setado —
  host-only cobre os dois);
- ou mover a checagem de sessão do middleware para um endpoint
  BFF (Backend-for-Frontend) no próprio Next.js, que faria a chamada
  servidor-a-servidor à API sem depender do cookie cruzar hosts no navegador.

Se o `Path` for restringido de novo no futuro sem essa mudança de
infraestrutura, o sintoma será usuários autenticados sendo redirecionados
para `/login` (o middleware nunca vê o cookie) e/ou `/auth/refresh` sempre
retornando `401 MISSING_REFRESH_TOKEN`.

## RBAC

`Role` (enum de sistema) → `Permission` (chave livre, ex. `"orders.cancel"`)
via `RolePermission`. Um usuário recebe papéis por tenant (`UserRole`).
Guards:

- `@Roles('OWNER', 'ADMIN')` + `RolesGuard`
- `@RequirePermissions('users.read')` + `PermissionsGuard`

Ambos os guards são globais (`APP_GUARD`) e são "no-op" (permitem a
requisição) quando o decorator não é usado na rota — só entram em ação onde
explicitamente aplicados.

## Multi-tenancy na autenticação

O `tenantId` do usuário autenticado vem **exclusivamente** do payload do JWT
(via `@CurrentUser()`), nunca de `body.tenantId` ou `?tenantId=`. Ver
`docs/multi-tenancy.md`.

## Outras proteções

- `helmet()` para headers HTTP seguros
- CORS restrito a `CORS_ORIGIN`, com `credentials: true`
- `ThrottlerModule` — 100 requisições/60s por padrão (ajustável)
- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` — qualquer
  campo não declarado no DTO é rejeitado, mitigando mass assignment
- Segredos apenas via variáveis de ambiente, nunca hardcoded; `.env` está no
  `.gitignore`, apenas `.env.example` é versionado
- Logs redigem `authorization`, cookies e campos de senha/token
  automaticamente (`nestjs-pino` `redact`)
