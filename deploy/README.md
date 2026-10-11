# Implantação em containers (Linux)

O sistema inteiro em containers Linux: **API**, **web**, **PostgreSQL** e **Redis**. Serve para
testar, em uma máquina, exatamente o build que iria para uma hospedagem, antes de a hospedagem
existir. Validado localmente em 2026-10-10; **não é uma declaração de que o produto está pronto para
produção**.

| Arquivo | Para quê |
| --- | --- |
| `deploy/api.Dockerfile` | Imagens da API: `runtime` (atende requisições), `migrator` (migrations + seed) e `e2e` (testes) |
| `deploy/web.Dockerfile` | Imagem do web (Next.js) |
| `deploy/compose.yml` | Sobe os quatro serviços, com o job de migrations |
| `deploy/.env.example` | Variáveis do Compose, com valores de exemplo |
| `.dockerignore` (raiz) | O que não entra no contexto de build (dependências, builds e `.env` locais) |

## Versões fixadas

| Item | Versão | Onde está fixada |
| --- | --- | --- |
| Node.js | 24.14.1 | `ARG NODE_VERSION` nos dois Dockerfiles |
| pnpm | 9.12.0 | `ARG PNPM_VERSION` (o mesmo de `packageManager`) |
| Sistema da imagem | Debian 12 (`bookworm-slim`), glibc, OpenSSL 3 | `FROM` dos Dockerfiles |
| PostgreSQL | 16 (`postgres:16-alpine`) | `deploy/compose.yml` |
| Redis | 7 (`redis:7-alpine`) | `deploy/compose.yml` |
| Dependências do projeto | as do `pnpm-lock.yaml` (`--frozen-lockfile`) | lockfile |

Testado com Docker Engine 29.5.3 e Docker Compose v5.1.4.

## Subir

```bash
cp deploy/.env.example deploy/.env      # depois edite deploy/.env
docker compose -f deploy/compose.yml up -d --build
```

O primeiro build leva alguns minutos. A ordem de partida é: PostgreSQL e Redis saudáveis →
job `migrate` termina com sucesso → API saudável → web.

- Web: http://localhost:3000
- API: http://localhost:4000 (só para verificação e só nesta máquina; o navegador fala apenas com o
  web, em `/api`)

O primeiro restaurante é criado em http://localhost:3000/register.

## Verificar

```bash
docker compose -f deploy/compose.yml ps                 # api, web, postgres e redis "healthy"
curl -s http://localhost:4000/health/ready              # {"status":"ok", postgres up, redis up}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/me    # 401 = o web alcança a API
docker compose -f deploy/compose.yml logs migrate       # 17 migrations aplicadas e "Seed complete"
```

"Saudável" aqui não é porta aberta: a API só fica saudável quando `/health/ready` confirma PostgreSQL
e Redis; o web só fica saudável quando a página de login responde **e** uma chamada pelo `/api`
chega à API.

## Acompanhar logs

```bash
docker compose -f deploy/compose.yml logs -f api web
docker compose -f deploy/compose.yml logs --tail 100 api
```

## Encerrar

```bash
docker compose -f deploy/compose.yml down        # para e remove os containers; os dados ficam
docker compose -f deploy/compose.yml down -v     # APAGA também o banco desta pilha
```

## Migrations e seed

- Rodam em um **job separado** (`migrate`), nunca na partida da API. O job executa
  `prisma migrate deploy` e depois o seed de papéis e permissões.
- O seed é idempotente e **não cria restaurante, usuário nem dado de demonstração**.
- O job roda a cada `up`. Sem migration pendente ele responde "No pending migrations to apply".
- No Compose, o endereço do banco é montado no próprio arquivo a partir do serviço `postgres`:
  **esta pilha não lê `DATABASE_URL` do ambiente e não alcança banco externo, DEV ou produção**.
- Rodar só o job: `docker compose -f deploy/compose.yml run --rm migrate`.

Em uma hospedagem, a imagem `runtime` da API **não aplica migrations sozinha**. Quem implanta roda a
imagem `migrator` (ou os comandos `pnpm --filter api prisma:deploy` e
`pnpm --filter api prisma:seed:prod`) contra o banco escolhido, antes de iniciar a API. Em banco que
já tenha pedidos: backup conferido e o preflight somente leitura descrito no relatório de validação,
antes das migrations.

## Testes E2E em Linux

```bash
docker compose -f deploy/compose.yml --profile e2e run --rm e2e
```

Roda a suíte completa dentro de um container, contra um banco **separado** no PostgreSQL desta pilha
(`<POSTGRES_DB>_e2e`, criado na primeira execução). O banco em que você está testando o sistema não
recebe nada. Resultado em 2026-10-10: 46 suítes, 777 testes, 0 falhas.

## Usar as imagens em uma hospedagem

```bash
docker build -f deploy/api.Dockerfile --target runtime  -t restaurant-saas-api .
docker build -f deploy/api.Dockerfile --target migrator -t restaurant-saas-api-migrator .
docker build -f deploy/web.Dockerfile --build-arg API_URL=https://<api>/v1 -t restaurant-saas-web .
```

Variáveis, só os nomes:

- **API** (`runtime` e `migrator`): `DATABASE_URL`. Só `runtime`: `REDIS_URL`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `CORS_ORIGIN`, `TRUST_PROXY_HOPS`, e opcionais `PORT`,
  `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `AUTH_RATE_LIMIT_PER_MINUTE`. `NODE_ENV=production`
  já vem na imagem.
- **Web**: `API_URL`, no **build** (argumento) e na execução. O endereço fica gravado no build: uma
  imagem do web serve para um endereço de API.

Saúde: API em `/health/live` (processo) e `/health/ready` (PostgreSQL + Redis), sem `/v1`. Os dois
Dockerfiles já declaram `HEALTHCHECK`.

## O que a imagem final contém

- Instalada com `NODE_ENV=production` e `pnpm install --prod`: **sem** devDependencies. Conferido na
  imagem da API: `typescript`, `@nestjs/cli`, `prisma` e `jest` ausentes.
- Compilação (`prisma generate`, `nest build`, `next build`) acontece em um estágio anterior, que tem
  as devDependencies e não vai para a imagem final.
- Processo como usuário `node`, não root.
- Nenhum `.env` entra na imagem.

## Endereço do cliente (`TRUST_PROXY_HOPS`)

O navegador nunca chama a API: chama o web, que repassa `/api` para ela. A API precisa saber quem é
cada aparelho para os limites de requisição, a auditoria e `refresh_tokens.ip`. O `/api` do Next,
sozinho, não informa isso: não envia `X-Forwarded-For`, ou repassa o que o próprio cliente mandou.

Por isso o web sobe com um servidor próprio (`apps/web/server.js`) que **acrescenta ao
`X-Forwarded-For` o endereço real de quem conectou nele**. Ele nunca substitui o cabeçalho nem
confia no que chegou: o que o cliente escreveu fica à esquerda e não vale nada, porque a API conta
`TRUST_PROXY_HOPS` entradas **a partir da direita**, e essas foram escritas por proxies.

`TRUST_PROXY_HOPS` é o número de proxies entre o navegador e a API, **contando o web**:

| Caminho | Valor |
| --- | --- |
| navegador → web → API (este Compose) | 1 |
| navegador → proxy TLS ou balanceador → web → API | 2 |
| cada proxy a mais na frente | +1 |

Tem de ser o número exato. Os três erros possíveis estão fixados em teste
(`apps/api/test/trust-proxy.e2e-spec.ts`):

- **a menos**: seguro, mas todos os aparelhos viram um endereço só e dividem os limites;
- **a mais**: inseguro — a API acredita em uma entrada escrita pelo cliente;
- **API alcançável por fora dos proxies**: quem chega nela direto escreve o próprio cabeçalho, e a
  API acredita. Por isso este Compose publica a API **apenas em 127.0.0.1**, qualquer que seja
  `BIND_ADDRESS`. Em uma hospedagem, deixe a API sem endereço público (rede privada entre web e
  API). Se ela tiver endereço público, um chamador direto consegue forjar o endereço e escapar dos
  limites por endereço.

Conferir depois de entrar pelo web em dois aparelhos:

```bash
docker compose -f deploy/compose.yml exec postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select ip, count(*) from refresh_tokens group by 1"'
```

Tem de aparecer o endereço de cada aparelho. Nunca o do container do web, e nunca um valor mandado
no cabeçalho. Abrindo do próprio computador, o endereço é o do gateway da rede Docker.

Medido nesta pilha em 2026-10-10, com dois endereços reais de origem e limite de 3 logins por
minuto: os dois foram gravados com o próprio endereço, com e sem cabeçalho forjado; o primeiro
recebeu `429` na quarta tentativa e continuou recebendo ao forjar três cabeçalhos diferentes; o
segundo não foi afetado, nem ao forjar o endereço do primeiro, e recebeu `429` na própria quarta
tentativa. Antes da correção, com `TRUST_PROXY_HOPS=1`, o endereço forjado era o gravado.

## Limites conhecidos

- **O endereço do cliente depende de `TRUST_PROXY_HOPS` estar certo** e de a API não ser alcançável
  por fora do web (seção acima). Só foi medido neste Compose. Em uma hospedagem, o que o balanceador
  da plataforma faz com o `X-Forwarded-For` (acrescentar ou sobrescrever) precisa ser conferido com a
  consulta acima. Na Vercel o `/api` é executado pela plataforma e `apps/web/server.js` não roda: o
  que ela envia à API não foi medido.
- **Limites em memória, por instância da API.** 10 logins, 30 renovações de sessão e 100 requisições
  por rota, por minuto e por endereço. Aparelhos atrás do mesmo roteador, vistos de fora, têm o
  mesmo endereço público e **dividem esses limites**: eles valem, na prática, por restaurante.
  O que cada tela gasta (medido nesta pilha em 2026-10-10): a Cozinha faz 12 requisições por minuto
  na rota do quadro (`/orders/board`, uma por leitura); todo aparelho com o painel aberto faz 3 por
  minuto na rota de pedidos (o aviso de pedidos novos) e 2 na do caixa; a lista de Pedidos soma 4.
  Cinco telas de cozinha mais três aparelhos na lista de Pedidos ficaram em 60 e 36 de 100, sem
  nenhuma recusa. Passando de cerca de 8 telas de cozinha, ou de umas 30 telas no total, no mesmo
  endereço, a API volta a responder `429` e o endereço fica bloqueado nessa rota por um minuto.
  Limitar por usuário em vez de por endereço é uma decisão ainda não tomada.
- **Cookie de sessão exige HTTPS fora de `localhost`.** Com `NODE_ENV=production` o cookie sai com
  `Secure`. Em `http://localhost:3000` funciona (validado no Chrome); em `http://<IP-da-rede>:3000`,
  aberto de um celular, o navegador não guarda o cookie e o login não se mantém (comportamento padrão
  dos navegadores; não testado aqui). Teste em aparelhos pede um endereço com HTTPS.
- **Uma instância da API.** O limite de requisições é em memória.
- **Sem backup.** O volume `pgdata` é o único lugar em que os dados desta pilha existem.
- **`BIND_ADDRESS`**: mudar de `127.0.0.1` publica o web na rede. A API continua só em `127.0.0.1`,
  e PostgreSQL e Redis continuam sem porta publicada.
- **Tamanho das imagens**: API 531 MB, web 949 MB, migrator 1,05 GB. Não foram otimizadas.
- A API encerra com código 143 no `stop`: o Nest termina as requisições em andamento, desconecta do
  banco e reenvia o sinal recebido.
