# Autenticação e segurança

## Hash de senha

Argon2 (`argon2` npm package), não texto puro, não bcrypt/md5/sha.

## Tokens

- **Access token**: JWT curto (`JWT_ACCESS_EXPIRES_IN`, padrão `15m`),
  assinado com `JWT_ACCESS_SECRET`. Contém `sub` (userId), `tenantId`,
  `email`, `roles` e `permissions` já resolvidos — evita uma consulta ao
  banco a cada requisição só para saber o que o usuário pode fazer.
  Devolvido no **corpo** da resposta; o frontend guarda em memória
  (React state), nunca em `localStorage`. Leva também `sid` (a sessão a que
  pertence) e `iatMs` (emissão em milissegundos), usados só pela revogação
  descrita abaixo.
- **Refresh token**: JWT mais longo (`JWT_REFRESH_EXPIRES_IN`, padrão `7d`),
  assinado com `JWT_REFRESH_SECRET`, contém apenas `sub`, um `jti` aleatório e
  o `sid` da sessão (o mesmo do access token; a rotação mantém o `sid`).
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

## Revogação imediata do access token

O access token é um JWT sem estado: revogar o refresh token no banco não o
invalida, e ele continuaria aceito até expirar (15 min). Uma lista de
revogação no Redis fecha essa janela (`SessionRevocationService`, consultada
pelo `JwtStrategy` em toda requisição autenticada, um `MGET`):

| Evento | Marca gravada | Efeito |
|---|---|---|
| `POST /auth/logout` que de fato encerrou uma sessão | `auth:revoked:session:<sid>` | todo access token **daquela sessão** passa a responder `401 SESSION_REVOKED`, inclusive os emitidos antes de uma rotação; as outras sessões do mesmo usuário seguem |
| reuso de refresh token fora da janela de tolerância (token roubado) | `auth:revoked:user:<userId>` = instante do evento | todo access token do usuário emitido **até aquele instante** morre; um login feito depois funciona normalmente |
| restaurante suspenso pela plataforma (`POST /platform/tenants/:id/suspend`) | `auth:revoked:tenant:<tenantId>` = instante da suspensão | todo access token de **todas as contas do restaurante** emitido até aquele instante morre; login e refresh já são recusados enquanto ele estiver suspenso, e depois da reativação um login novo funciona |

- Cada marca expira sozinha depois do tempo de vida do access token mais 60 s:
  a lista nunca cresce.
- Para o frontend é um `401` como outro qualquer: ele tenta o refresh, que é
  recusado, e a sessão local termina.
- **Decisão — falha aberta:** se o Redis não responder, o token é aceito como
  antes de a lista existir (limitado pelos seus 15 min) e o erro vai para o
  log. Derrubar o caixa de todos os restaurantes porque um cache caiu seria
  pior do que a janela que a lista fecha. A escrita que falha também não
  transforma o logout em erro (o refresh token já foi revogado no banco).
- Tokens emitidos antes de existir `sid` continuam válidos até expirar e só
  são alcançados pela marca por usuário.
- **Não coberto:** mudar o status de um restaurante ou bloquear um usuário
  **direto no banco** não grava marca nenhuma: o access token já emitido vale
  até expirar; login e refresh são recusados na hora. Pelo painel da plataforma
  (`/super-admin`, docs/SUPER_ADMIN.md) a suspensão grava a marca do tenant.

## O que o login revela

A senha é conferida **antes** de qualquer coisa ser dita sobre a conta:

- e-mail desconhecido e senha errada respondem o mesmo `401
  INVALID_CREDENTIALS`, e o e-mail desconhecido faz o mesmo trabalho de Argon2
  (contra um hash que ninguém tem), então o tempo de resposta não distingue
  os dois casos;
- `USER_NOT_ACTIVE` (conta bloqueada) e `TENANT_NOT_ACTIVE` (restaurante
  suspenso) só aparecem para quem acertou a senha;
- a tentativa com senha errada contra uma conta real continua auditada
  (`LOGIN_FAILED`).

### E-mail sem diferença de maiúsculas (desde 2026-11-10)

O e-mail é o login e é comparado **sem** diferenciar maiúsculas de minúsculas
(`apps/api/src/common/util/login-email.util.ts`):

- toda gravação guarda o e-mail aparado e em minúsculas (cadastro de
  funcionário, provisionamento pelo comando e pelo painel da plataforma);
- toda busca compara `lower(email)`: login, conferência de duplicidade e os
  comandos `platform-admin:grant`/`revoke` e `user:reset-password`. Uma conta
  gravada com maiúsculas antes dessa data continua entrando, e o e-mail dela
  **não** é reescrito;
- `Ana@x.com` e `ana@x.com` são o mesmo login: o segundo cadastro é recusado
  com `EMAIL_ALREADY_EXISTS`. Se já existirem duas contas antigas que só
  diferem na caixa, entra a que for digitada exatamente como foi gravada; com
  qualquer outra grafia, nenhuma (o login não adivinha de quem é a senha);
- SQL puro de propósito: o `mode: 'insensitive'` do Prisma vira `ILIKE`, em
  que `_` é curinga.

Sem migration: o índice único de `users.email` continua o mesmo.

## Sem cadastro público (desde 2026-10-28)

O serviço é vendido, não é autoatendimento: ninguém cria restaurante pela API. `POST /auth/register`
foi removido e responde `404` como qualquer rota inexistente, com ou sem sessão, sem criar tenant,
unidade ou usuário. As únicas rotas públicas de autenticação são `login`, `refresh` e `logout`.

Um restaurante (tenant + primeira unidade + conta OWNER) é criado por
`TenantProvisioningService` (`apps/api/src/modules/tenants/`), que **não tem rota HTTP**: quem o chama
é o comando local `tenant:provision` (docs/PROVISIONING.md), rodado por quem tem o `DATABASE_URL`, e os
e2e, pelo container Nest do teste. O serviço valida os dados com as mesmas regras de um corpo de
requisição, recusa slug, documento ou e-mail já usados (`409 TENANT_ALREADY_EXISTS` /
`EMAIL_ALREADY_EXISTS`, também numa criação simultânea), grava `TENANT_PROVISIONED` na mesma transação e
não abre sessão: o OWNER entra pelo
`POST /auth/login`. No web, `/login` tem só e-mail, senha e Entrar; `/register` mostra apenas que
"Novos acessos são liberados diretamente pela equipe responsável", sem formulário.

Desde o Super Admin (docs/SUPER_ADMIN.md) o mesmo serviço tem uma segunda porta, **não pública**:
`POST /platform/tenants`, só para administradores da plataforma (`PlatformAdminGuard`; anônimo `401`,
qualquer conta de restaurante `403`, OWNER e ADMIN inclusive).

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
  causa de uma oscilação de rede seria pior do que o erro;
- a mesma regra vale ao **abrir** o painel: se a troca inicial do cookie por
  um access token não recebe veredito, o layout do dashboard não redireciona
  ao `/login`; mostra "não foi possível falar com o servidor" com nova
  tentativa (automática quando o aparelho volta a ter rede). Só `401`/`403`
  contam como "não está logado" (`isSessionRefusal`, `lib/session-area.ts`).

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

**Vários ambientes na mesma máquina:** o navegador não separa cookies por
porta. `localhost:3000`, `localhost:3100` e `localhost:3300` compartilham o
mesmo `refresh_token`: entrar em um derruba a sessão dos outros. Para usar
dois ambientes ao mesmo tempo, abra cada um por um nome de host diferente
(`localhost` em um, `127.0.0.1` no outro) ou num perfil separado do navegador.
O ambiente da apresentação final usa `http://127.0.0.1:3600` por isso.

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

## Equipe e senhas

Contas de funcionários são criadas pela gestão em `/dashboard/usuarios`
(`POST /v1/users`, `PATCH /v1/users/:id`, `POST /v1/users/:id/reset-password`).
Não há convite nem recuperação por e-mail: quem cadastra define a senha inicial e
a entrega à pessoa.

- **Quem pode**: `users.create` / `users.update` (OWNER e ADMIN no seed). O gerente
  só lê (`users.read`). Regras adicionais em `modules/users/user-rules.ts`: o papel
  OWNER nunca é atribuído; só o OWNER cria, promove ou altera um ADMIN; a conta do
  OWNER não é alterada por ninguém; ninguém altera a própria conta por essas rotas.
- **Unidades**: papéis que não são OWNER/ADMIN precisam de ao menos uma unidade. Com
  uma única unidade ativa ela é atribuída sozinha; com várias, a lista é obrigatória
  (`400 BRANCHES_REQUIRED`). Unidade inexistente ou de outro restaurante: `404`.
- **E-mail** é o login e é único entre todos os restaurantes (`409 EMAIL_ALREADY_EXISTS`),
  como no provisionamento do restaurante. Não é editável.
- **Inativar** (`active: false`) em vez de excluir: o histórico da pessoa continua.
- **Sessões**: o access token carrega papéis e permissões. Mudar o papel, inativar ou
  redefinir a senha revoga os refresh tokens na mesma transação e, logo após o commit,
  os access tokens (denylist por usuário). Renomear ou trocar unidades não encerra a
  sessão: os vínculos de unidade são relidos a cada requisição.
- **Trocar a própria senha**: `POST /v1/auth/change-password` (exige a senha atual,
  limitado como o login). Encerra todas as sessões da conta, inclusive a atual, e limpa
  o cookie. É o único caminho do próprio OWNER pelo sistema: ninguém no painel redefine a
  senha dele, e não há recuperação por e-mail.
- **OWNER (ou qualquer conta) que esqueceu a senha**: só o comando local, rodado por quem
  tem o `DATABASE_URL` (não há rota HTTP para isso):

  ```bash
  pnpm user:reset-password -- --email dono@empresa.com.br
  ```

  Mostra banco, host, identificador do cluster, ambiente, Redis, a conta (restaurante,
  papéis, se é administradora da plataforma, sessões ativas), pergunta a nova senha duas
  vezes sem eco (nunca como argumento) e só grava depois de `REDEFINIR`. Mesmo Argon2 e
  mesma regra de tamanho do painel; encerra os refresh tokens na transação e corta os
  access tokens no Redis (por isso se recusa a rodar sem Redis acessível). Papéis,
  restaurante e administração da plataforma não mudam. `DATABASE_URL`, `REDIS_URL` e
  `JWT_ACCESS_EXPIRES_IN` vêm todos das variáveis de ambiente ou todos do `.env` da pasta.
  Na imagem de produção: `pnpm --filter api user:reset-password:prod -- --email ...`.
- **Auditoria**: `USER_CREATED`, `USER_UPDATED` e `USER_PASSWORD_RESET` são gravadas na
  mesma transação; `PASSWORD_CHANGED` e `PASSWORD_CHANGE_FAILED` são best-effort. Nenhuma
  guarda nome, e-mail ou senha. `ADMIN_PASSWORD_RESET` (o comando acima) vai na mesma
  transação da troca, com o e-mail da conta, quem rodou (`usuário@máquina`) e quantas
  sessões foram encerradas; nunca a senha nem o hash.
- **Limite conhecido**: um refresh que já passou das próprias verificações no instante
  do commit pode emitir tokens novos. A redefinição de senha faz uma segunda revogação
  depois do commit para fechar essa janela; na mudança de papel e na inativação a
  exposição é limitada pela validade do access token (15 min) e pela checagem de
  status no refresh seguinte.

## Multi-tenancy na autenticação

O `tenantId` do usuário autenticado vem **exclusivamente** do payload do JWT
(via `@CurrentUser()`), nunca de `body.tenantId` ou `?tenantId=`. Ver
`docs/multi-tenancy.md`.

## Outras proteções

- `helmet()` para headers HTTP seguros
- **Content-Security-Policy no frontend**, montada por requisição em
  `apps/web/middleware.ts` (`lib/csp.ts`): `script-src 'self' 'nonce-…'
  'strict-dynamic'`, sem `'unsafe-inline'` nem `'unsafe-eval'` — só rodam os
  scripts que o próprio Next emite com o nonce da requisição. Marcação
  injetada (um `<img onerror>` num nome de produto, um link `javascript:`)
  não executa, e é isso que mantém o access token em memória fora do alcance
  de um XSS armazenado. `connect-src 'self'` (o navegador só fala com o
  próprio host, por causa do proxy `/api`), `frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`. `style-src`
  mantém `'unsafe-inline'` (atributos `style` do React) e `img-src` aceita
  qualquer origem `https:` (as fotos dos produtos são URLs externas).
  Consequência: **toda rota é renderizada por requisição** (o layout raiz lê o
  nonce); uma página pré-renderizada sairia com scripts sem nonce e o
  navegador recusaria todos. Limite conhecido: `'strict-dynamic'` confia em
  scripts criados por scripts já confiáveis; a política barra injeção de
  marcação, não um invasor que já executa código na página
- Demais headers do frontend (`next.config.js`): `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (câmera,
  microfone, geolocalização, pagamento e USB negados) e, em build de produção,
  `Strict-Transport-Security`
- Visitante anônimo não dispara refresh: na página inicial, no cardápio
  público (`/menu`), na demonstração (`/demo`) e no aviso de `/register` o
  `AuthProvider` fica parado (`lib/session-area.ts`); a troca do cookie por um
  access token só acontece em `/login` e `/dashboard`
- Slug de cardápio inexistente (ou de restaurante suspenso) responde **HTTP
  404** de verdade para o cardápio, o carrinho e o checkout: a consulta é
  feita no layout do segmento, antes de a resposta começar
- CORS restrito a `CORS_ORIGIN`, com `credentials: true`
- `ThrottlerModule` — 100 requisições/60s por rota e por endereço do cliente;
  login e registro usam `AUTH_RATE_LIMIT_PER_MINUTE` (padrão 10), refresh e
  logout 30, prévia pública de cupom 20. O contador é em memória, por instância
  (com mais de uma instância os limites se multiplicam; mover para o Redis é
  pendência conhecida). Passado o limite, o endereço fica bloqueado naquela
  rota por um minuto. "Por endereço" é, na prática, por restaurante: os
  aparelhos de um mesmo Wi-Fi saem por um endereço só. Por isso as telas que
  consultam sozinhas gastam pouco: a Cozinha lê o quadro inteiro em uma
  requisição (`GET /orders/board`, 12 por minuto por tela, em vez de 48 na
  rota da lista), e o frontend não repete sozinho uma requisição que a API
  recusou (4xx, incluindo `429`); só falha de rede e 5xx são repetidas
- `TRUST_PROXY_HOPS` — quantos proxies reversos na frente da API têm a entrada
  de `X-Forwarded-For` aceita como endereço do cliente (padrão 0 = nenhum). É
  um número, nunca "confiar em tudo": com o valor errado, ou todos os clientes
  caem no mesmo contador de rate limit (proxy contado a menos), ou qualquer um
  escolhe o próprio endereço (proxy contado a mais). O valor certo depende da
  plataforma e precisa ser conferido no ambiente real: depois de um login pelo
  site, `refresh_tokens.ip` tem de mostrar o IP público de quem acessou
- **Endereço do cliente.** O navegador só fala com o frontend, então o
  frontend é um proxy na frente da API e **conta em `TRUST_PROXY_HOPS`**. O
  `/api` do Next, sozinho, não envia `X-Forwarded-For` (ou repassa o que o
  cliente mandou); por isso o frontend sobe com `apps/web/server.js`, que
  acrescenta ao cabeçalho o endereço de quem conectou nele, sem substituir
  nem interpretar o que chegou. Navegador → frontend → API = 1; com um proxy
  TLS ou balanceador na frente do frontend = 2. A API só pode ser alcançável
  por esses proxies: quem a chama direto escreve o próprio cabeçalho. Os
  cenários (aparelhos diferentes, mesmo aparelho, cabeçalho forjado, um e
  dois proxies, contagem errada para menos e para mais, chamada direta) estão
  em `test/trust-proxy.e2e-spec.ts` e em `apps/web/server/*.test.ts`. Na
  Vercel o `/api` é executado pela plataforma e `server.js` não roda: o que
  ela envia à API precisa ser medido
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
