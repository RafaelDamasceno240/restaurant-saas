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
- API: http://localhost:4000 (só para verificação; o navegador fala apenas com o web, em `/api`)

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
recebe nada. Resultado em 2026-10-10: 45 suítes, 757 testes, 0 falhas.

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

## Limites conhecidos

- **A API não sabe o endereço de quem acessa pelo web.** O `/api` do Next (em `next start`) não envia
  `X-Forwarded-For` (medido: só `x-forwarded-host`). Para a API, todos os navegadores são um único
  endereço, o do web. Consequência: os limites por endereço valem para **o restaurante inteiro
  junto** — 10 logins por minuto, 30 renovações de sessão por minuto e 100 requisições por minuto em
  cada rota — e o endereço gravado em `refresh_tokens.ip` e na auditoria é o do web. Com vários
  aparelhos ao mesmo tempo isso pode devolver `429`. Corrigir exige mudança de código (fazer o web
  repassar o endereço, ou limitar por usuário) e ainda não foi feito. Por isso `TRUST_PROXY_HOPS=0`.
- **Cookie de sessão exige HTTPS fora de `localhost`.** Com `NODE_ENV=production` o cookie sai com
  `Secure`. Em `http://localhost:3000` funciona (validado no Chrome); em `http://<IP-da-rede>:3000`,
  aberto de um celular, o navegador não guarda o cookie e o login não se mantém (comportamento padrão
  dos navegadores; não testado aqui). Teste em aparelhos pede um endereço com HTTPS.
- **Uma instância da API.** O limite de requisições é em memória.
- **Sem backup.** O volume `pgdata` é o único lugar em que os dados desta pilha existem.
- **`BIND_ADDRESS`**: mudar de `127.0.0.1` publica API e web na rede. PostgreSQL e Redis continuam sem
  porta publicada em qualquer caso.
- **Tamanho das imagens**: API 531 MB, web 949 MB, migrator 1,05 GB. Não foram otimizadas.
- A API encerra com código 143 no `stop`: o Nest termina as requisições em andamento, desconecta do
  banco e reenvia o sinal recebido.
