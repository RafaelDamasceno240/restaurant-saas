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

`POST /auth/logout` revoga o refresh token atual e limpa o cookie. A rota é
`@Public()` de propósito: quem sai depois de 15 minutos parado já não tem um
access token válido, e uma sessão que não pode ser encerrada é pior do que uma
encerrada sem ele. Isso não afrouxa nada: a rota não aceita corpo nem
parâmetro, e a única sessão que ela encerra é a do refresh token que chega no
cookie `httpOnly` — assinado com `JWT_REFRESH_SECRET` e conferido por hash
contra a linha do próprio usuário. Sem cookie, com cookie forjado, expirado ou
já revogado, a rota responde `204` e não encerra nem registra nada.

## Renovação do access token no frontend

O access token dura 15 minutos e a sessão dura 7 dias, então ele expira várias
vezes durante um turno. Quem cuida disso é `apps/web/lib/api-client.ts`:

- uma chamada autenticada que recebe `401` pede um novo access token
  (`POST /auth/refresh`) e é **repetida uma única vez**;
- todas as chamadas que receberam `401` ao mesmo tempo esperam a **mesma**
  promessa de refresh — nunca há dois refresh simultâneos na página, o que
  importa porque o refresh token é de uso único;
- entre abas do mesmo navegador (que dividem o cookie), o refresh roda dentro
  de um Web Lock, para uma aba não enviar o token que a outra acabou de trocar;
- a repetição vai direto à rede: se ela também receber `401`, o erro sobe para
  a tela, sem novo refresh;
- se o refresh for **recusado** (`401`/`403`), a sessão local é encerrada, o
  cache de dados é limpo e o layout do dashboard leva o usuário ao `/login`;
  depois disso nenhum `401` dispara outro refresh até um novo login;
- se o refresh **falhar sem veredito** (rede, `5xx`, `429`), a sessão é
  mantida: a chamada falha e a próxima tenta de novo. Deslogar o caixa por
  causa de uma oscilação de rede seria pior do que o erro.

## Por que não access token em cookie também?

Manter o access token fora de cookies evita CSRF nas rotas que ele protege
(ele só é enviado explicitamente via header `Authorization`, nunca
automaticamente pelo browser). O refresh token, por sua vez, só é aceito nas
rotas `/auth/refresh` — que valida o token contra o hash gravado no banco e o
revoga em caso de reuso — e `/auth/logout`, que só sabe encerrar a sessão do
próprio token, e teria uso limitado mesmo se exfiltrado via um XSS
que também comprometesse `httpOnly` — o que já não é o modelo de ameaça que
cookies `httpOnly` cobrem, mas reduz a superfície. (O `Path=/` do cookie, ver
seção seguinte, amplia onde o *navegador* o envia automaticamente — não amplia
quais rotas da API o *aceitam*: isso continua restrito a `/auth/refresh` e
`/auth/logout`. O `SameSite=Lax` impede que outro site dispare esses `POST`
levando o cookie.)

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
   requisições para `/dashboard`. `/dashboard` nunca é prefixado por `/auth`
   nem por `/v1/auth`, então um cookie com esses paths nunca apareceria ali.

`/` é o único valor que é prefixo de ambos ao mesmo tempo.

### O navegador só fala com o frontend (proxy `/api`)

`Path` resolve o prefixo, mas não o **host**: um cookie sem `Domain` pertence
ao host exato que o recebeu. Com o frontend na Vercel e a API no Railway, um
cookie emitido pela API ficaria guardado para o host da API — o middleware do
Next nunca o veria e, entre domínios diferentes, o navegador nem o guardaria
(`SameSite=Lax` numa resposta cross-site).

Por isso o navegador **nunca chama a API diretamente**. O Next reescreve
`/api/:path*` para a API (`rewrites()` em `apps/web/next.config.js`):

```
navegador ──▶ https://<frontend>/api/auth/login ──(rewrite)──▶ https://<api>/v1/auth/login
```

- no navegador, `api-client.ts` usa a base relativa `/api`; o `Set-Cookie` da
  API volta pela mesma resposta e o cookie fica guardado **para o host do
  frontend** — primeira parte, sem `Domain`, visível ao `middleware.ts`;
- no servidor (Server Components do cardápio público e da confirmação do
  pedido), `api-client.ts` chama a API pela URL absoluta de `API_URL`;
- `API_URL` é uma variável **só de servidor** (não é `NEXT_PUBLIC_`): o
  endereço da API não vai para o bundle do navegador. Ela é lida no build
  (destino da rewrite) e em execução (Server Components), então precisa estar
  definida nos dois momentos.

Como tudo é mesma origem para o navegador, o CORS da API deixa de participar
do fluxo normal (continua restrito a `CORS_ORIGIN`).

Se o `Path` for restringido de novo, ou se alguma tela voltar a chamar a API
por URL absoluta a partir do navegador, o sintoma será usuários autenticados
sendo redirecionados para `/login` (o middleware nunca vê o cookie) e/ou
`/auth/refresh` sempre retornando `401 MISSING_REFRESH_TOKEN`.

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
- `ThrottlerModule` — 100 requisições/60s por rota e por endereço do cliente;
  login e registro usam `AUTH_RATE_LIMIT_PER_MINUTE` (padrão 10), refresh e
  logout 30, prévia pública de cupom 20. O contador é em memória, por instância
- `TRUST_PROXY_HOPS` — quantos proxies reversos na frente da API têm a entrada
  de `X-Forwarded-For` aceita como endereço do cliente (padrão 0 = nenhum). É
  um número, nunca "confiar em tudo": com o valor errado, ou todos os clientes
  caem no mesmo contador de rate limit (proxy contado a menos), ou qualquer um
  escolhe o próprio endereço (proxy contado a mais). O valor certo depende da
  plataforma e precisa ser conferido no ambiente real: depois de um login pelo
  site, `refresh_tokens.ip` tem de mostrar o IP público de quem acessou
- `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` — qualquer
  campo não declarado no DTO é rejeitado, mitigando mass assignment
- Segredos apenas via variáveis de ambiente, nunca hardcoded; `.env` está no
  `.gitignore`, apenas `.env.example` é versionado
- Logs redigem `authorization`, cookies e campos de senha/token
  automaticamente (`nestjs-pino` `redact`) e registram só os **nomes** dos
  parâmetros de query string, nunca os valores (buscas levam nome, telefone e
  e-mail de clientes)
- `/health` e `/health/ready` informam apenas `up`/`down` por dependência; a
  causa da falha fica no log do servidor
