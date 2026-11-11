# Implantação em containers (Linux)

O sistema inteiro em containers Linux: **API**, **web**, **PostgreSQL** e **Redis**. Serve para
testar, em uma máquina, exatamente o build que iria para uma hospedagem, antes de a hospedagem
existir. Validado localmente em 2026-10-10 e 2026-10-11; **não é uma declaração de que o produto está
pronto para produção**, e nada aqui foi executado em uma hospedagem.

| Arquivo | Para quê |
| --- | --- |
| `deploy/api.Dockerfile` | Imagem de produção da API, e só ela. Iniciá-la sobe a API; nunca aplica migrations, seed ou testes |
| `deploy/api.migrate.Dockerfile` | Job de banco: migrations e seed de papéis e permissões. Roda uma vez por versão e termina |
| `deploy/migrate.js` | O que o job executa: `status`, `migrate`, `seed` e `release` |
| `deploy/api.e2e.Dockerfile` | Ferramenta de teste (suíte E2E em Linux). **Nunca é implantada** |
| `deploy/web.Dockerfile` | Imagem do web (Next.js) |
| `deploy/compose.yml` | Sobe os quatro serviços, com o job de migrations antes da API |
| `deploy/verify-images.js` | Constrói as imagens sem alvo e confere o que saiu: comando de início, usuário, conteúdo |
| `deploy/.env.example` | Variáveis do Compose, com valores de exemplo |
| `deploy/backup.js` | Backup do banco desta pilha para fora do repositório, e a prova de que ele restaura |
| `deploy/compose.tunnel.yml` | Acrescenta um Cloudflare Quick Tunnel na frente do web, para demonstração pelo celular |
| `deploy/demo.js` | Abre e fecha o túnel da demonstração |
| `.dockerignore` (raiz) | O que não entra no contexto de build (dependências, builds e `.env` locais) |

## Versões fixadas

| Item | Versão | Onde está fixada |
| --- | --- | --- |
| Node.js | 24.14.1 | `ARG NODE_VERSION` nos quatro Dockerfiles (o verificador falha se divergirem) |
| pnpm | 9.12.0 | `ARG PNPM_VERSION` (o mesmo de `packageManager`) |
| Prisma | 5.22.0, CLI e cliente | lockfile; o job recusa rodar se as duas versões divergirem |
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

Não há cadastro público: `/register` só avisa que novos acessos são liberados pela equipe. O
restaurante é criado pelo comando administrativo, dentro do container da API:
`docker compose -f deploy/compose.yml exec api node dist/src/cli/provision-tenant.js` (pergunta os
dados, mostra o banco alvo e só cria depois de `CRIAR`). Ver docs/PROVISIONING.md.

## Verificar

```bash
docker compose -f deploy/compose.yml ps                 # api, web, postgres e redis "healthy"
curl -s http://localhost:4000/health/ready              # {"status":"ok", postgres up, redis up}
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/auth/me    # 401 = o web alcança a API
docker compose -f deploy/compose.yml logs migrate       # 17 migrations aplicadas e "Seed complete"
node deploy/verify-images.js                            # o que cada Dockerfile realmente produz
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
docker compose -f deploy/compose.yml down -v     # APAGA também o banco desta pilha (e o Redis)
```

Os dados ficam em dois volumes: `pgdata` (o banco) e `redisdata` (as sessões encerradas por logout).
O Redis precisa do volume: sem ele, depois de `down` + `up` o token de uma sessão que fez logout volta
a ser aceito até expirar (até 15 minutos). Medido em 2026-10-16 antes e depois da correção.

## Backup e restauração

```bash
node deploy/backup.js backup                       # grava em ../restaurant-saas-backups/homolog/
node deploy/backup.js verify <arquivo.dump>        # restaura em um banco descartável e compara
```

- `backup`: `pg_dump` (formato custom) do banco desta pilha, feito em um único snapshot, então o
  arquivo é consistente mesmo com o sistema em uso. Grava `<banco>_<data>_<hora>.dump` e um
  `.sha256` ao lado, **fora do repositório** (ele recusa uma pasta dentro do repositório). Confere
  que o arquivo não está vazio e que a cópia é idêntica à que o `pg_dump` escreveu. `--out <pasta>`
  escolhe outra pasta.
- `verify`: sobe um PostgreSQL 16 **descartável** (container próprio, sem rede, sem porta, apagado
  no fim), restaura o arquivo nele e compara com o banco desta pilha, que só é lido: migrations
  aplicadas, schema (`pg_dump --schema-only`), lista de tabelas, contagem de linhas e conteúdo de
  cada tabela (md5 das linhas, nenhum valor impresso). Sai com 0 só se tudo for igual. Se o sistema
  foi usado depois do backup, as diferenças aparecem, e isso é esperado.
- Nenhum dos dois restaura nada nesta pilha nem toca o banco de desenvolvimento.

Resultado em 2026-10-16: backup de 192 KB; restauração em 1,6 s; migrations, schema (1.263 linhas),
48 tabelas e as 377 linhas iguais. O mesmo arquivo, comparado depois de o sistema ser usado, acusou
as 11 tabelas alteradas e saiu com 1.

**Restaurar de verdade** (perda do banco desta pilha) **não foi executado**: parar API e web, criar
um banco vazio e aplicar `pg_restore --no-owner` nele, conferir com `verify`, e só então apontar a
pilha para ele. Faça o `verify` antes, para saber que o arquivo serve.

Guarde uma cópia dos arquivos em um segundo lugar (pendrive, outro disco): esta pasta fica no mesmo
disco que o banco.

## Uma imagem por função

Cada Dockerfile entrega **uma** imagem, e ela é o **último estágio** do arquivo. Isso importa porque
um build sem alvo (`docker build` puro, ou uma hospedagem que não deixa escolher o estágio) constrói
o último estágio. Até 2026-10-10 o último estágio de `deploy/api.Dockerfile` era o de testes:
construído sem alvo, ele produzia uma imagem cujo comando de início aplicava migrations, rodava o
seed e executava a suíte E2E contra o banco recebido (conferido com `docker build` e
`docker image inspect`). Agora os testes e o job de banco estão em arquivos próprios, e nenhum build
do arquivo de produção consegue selecioná-los.

| Imagem | Comando de início | Usuário | Mexe no schema? |
| --- | --- | --- | --- |
| API (`api.Dockerfile`) | `node dist/src/main.js` | `node` | Nunca |
| Job de banco (`api.migrate.Dockerfile`) | `node /app/deploy/migrate.js release` | `node` | Sim: é só para isso |
| Web (`web.Dockerfile`) | `node server.js` | `node` | Não acessa banco |
| Testes (`api.e2e.Dockerfile`) | migrations, seed e a suíte E2E | `node` | Sim, e cria dados de teste |

O `compose.yml` também não informa alvo: a pilha local roda exatamente o que um build sem alvo
produz.

### Conferir

```bash
node deploy/verify-images.js            # lê os arquivos, constrói as quatro imagens sem alvo e inspeciona
node deploy/verify-images.js --static   # só lê os arquivos (não precisa de Docker)
pnpm test:deploy                        # testes do deploy/migrate.js (sem banco e sem Docker)
```

O verificador confere, na imagem que o Docker realmente construiu: comando de início exato; usuário
`node`; `NODE_ENV=production`; na API, ausência de compilador, CLI do Prisma e ferramentas de teste,
presença do cliente Prisma gerado e da API compilada, ausência de fontes, testes e migrations; e que
a imagem da API, iniciada sem nenhuma variável, se comporta como a API (para por falta de
`DATABASE_URL`). No job de banco: CLI do Prisma na mesma versão do cliente, as 17 migrations e o
seed compilado. Os containers que ele inicia não têm rede e nenhum banco é usado.

O cliente Prisma é gerado no estágio de build (`prisma generate && nest build`) e copiado para a
imagem final. O próprio build da imagem da API falha se o cliente gerado não estiver nela.

As imagens herdam o `ENTRYPOINT` da imagem oficial do Node (`docker-entrypoint.sh`), um script que
só repassa o comando recebido. Nenhum Dockerfile daqui define outro.

Resultado em 2026-10-11 (Docker Engine 29.5.3): todas as verificações passaram com o BuildKit; a
imagem da API também foi construída do zero (`--no-cache`) e com o construtor antigo do Docker
(`DOCKER_BUILDKIT=0`), com o mesmo comando de início. **O construtor de uma hospedagem não foi
testado.**

## Migrations e seed

### Ordem de uma implantação

1. **Banco provisionado** e acessível, vazio na primeira vez. Redis no ar.
2. **Job de banco**, uma vez por versão: aplica as migrations pendentes e depois o seed.
3. Só com o job terminado em código 0: **iniciar a API** (uma ou mais instâncias).
4. **Saúde**: `/health/ready` da API responde 200; no web, `/login` responde 200 e `/api/auth/me`
   responde 401.

A API **não** aplica migrations nem seed ao iniciar, em nenhuma instância (conferido: duas
instâncias contra o mesmo banco, nenhuma linha de log e nenhum registro alterado). No Compose a
ordem é imposta: a API só inicia depois que o job termina com sucesso. Em uma hospedagem a ordem
depende de como a plataforma for configurada, e **isso não foi testado em nenhuma**.

### Comandos do job

```bash
# na pilha local
docker compose -f deploy/compose.yml run --rm migrate                                     # release
docker compose -f deploy/compose.yml run --rm migrate node /app/deploy/migrate.js status
docker compose -f deploy/compose.yml run --rm migrate node /app/deploy/migrate.js migrate
docker compose -f deploy/compose.yml run --rm migrate node /app/deploy/migrate.js seed

# com a imagem avulsa, contra o banco indicado em DATABASE_URL
docker run --rm -e DATABASE_URL=... restaurant-saas-api-migrate
docker run --rm -e DATABASE_URL=... restaurant-saas-api-migrate node /app/deploy/migrate.js status
```

| Comando | O que faz | Código de saída |
| --- | --- | --- |
| `status` | Só leitura: lista migrations aplicadas e pendentes | 0 em dia; 1 se há pendente ou falhada |
| `migrate` | `prisma migrate deploy`: aplica as pendentes, em ordem | 0, ou o código do Prisma |
| `seed` | Upsert de papéis, permissões e vínculos. Não cria restaurante, usuário nem dado de demonstração | 0, ou 1 |
| `release` (padrão) | `migrate` e depois `seed`. **O seed não roda se uma migration falhou** | 0 só se os dois passaram |

Antes de agir, o job imprime o servidor, a porta e o nome do banco de destino (nunca usuário, senha
ou parâmetros). Sem `DATABASE_URL` válida, com comando desconhecido ou com CLI e cliente do Prisma
em versões diferentes, ele não faz nada e sai com código 2. **Ele age no banco que receber:** quem o
inicia escolhe o banco.

No Compose, o endereço do banco é montado no próprio arquivo a partir do serviço `postgres`:
**a pilha não lê `DATABASE_URL` do ambiente e não alcança banco externo, DEV ou produção**. O job
roda a cada `up`.

### Quando rodar o seed

O seed é dado de referência do código (papéis e permissões), não dado de demonstração. Ele precisa
rodar **uma vez depois das migrations, a cada versão**, porque uma versão nova pode trazer
permissões novas; sem ele o cadastro de restaurante falha. É idempotente e só acrescenta: não apaga
nem altera o que já existe. Nunca faz parte da partida da API.

### O que foi testado (2026-10-11, PostgreSQL 16 local, bancos descartáveis)

| Situação | Resultado |
| --- | --- |
| Banco vazio, `release` | 17 migrations e seed; 48 tabelas, 8 papéis, 70 permissões, 245 vínculos; código 0 |
| `release` de novo | "No pending migrations"; mesmas contagens e mesmo histórico; código 0 |
| `seed` depois de apagar parte dele | Volta a 70 permissões e 245 vínculos; código 0 |
| `migrate` sem nada pendente | Não roda o seed; código 0 |
| Banco com versão antiga (15 migrations), `release` | Aplica só as 2 que faltam, depois o seed |
| Migration que falha no meio (objeto em conflito) | Código 1; o seed **não** roda; a migration fica registrada como falhada; **nada dela permanece no banco** (nem os valores de enum, nem a coluna, nem as tabelas criadas antes do erro) |
| `release` de novo sem corrigir | O Prisma recusa (`P3009`); código 1; nada muda |
| Banco com tabelas e sem histórico do Prisma | O Prisma recusa (`P3005`); código 1; o que existia fica intacto |
| `seed` em banco sem schema | Falha (`P2021`); código 1; nenhuma tabela criada |
| Servidor de banco inalcançável | `P1001`; código 1 |

### Se uma migration falhar

1. **Não inicie a API** da versão nova. O job terminou com código diferente de 0.
2. Leia o erro no log do job e o estado com `status`.
3. Corrija a causa no banco.
4. Marque a migration como revertida e rode o `release` de novo:

   ```bash
   docker run --rm -e DATABASE_URL=... restaurant-saas-api-migrate \
     node node_modules/prisma/build/index.js migrate resolve --rolled-back <nome_da_migration>
   docker run --rm -e DATABASE_URL=... restaurant-saas-api-migrate
   ```

Testado localmente: depois desses passos o schema ficou idêntico ao de um banco migrado de uma vez
(mesmo `pg_dump --schema-only`). No teste a migration falhada não deixou resíduo, porque o
PostgreSQL desfez o arquivo inteiro. **Isso foi observado em um caso, não é garantia para toda
migration:** confira o estado antes de marcar como revertida.

Não existe migration de volta: o Prisma só anda para a frente. Desfazer uma migration já concluída
é restaurar um backup. Em banco que já tenha pedidos: backup conferido por restauração e o preflight
somente leitura descrito no relatório de validação, **antes** do job.

## Demonstração pelo celular (Cloudflare Quick Tunnel, custo zero)

Publica **só o web** desta pilha em um endereço HTTPS temporário (`https://<aleatório>.trycloudflare.com`),
sem conta, login ou domínio. O endereço muda a cada início e deixa de funcionar quando o túnel fecha.
Serve para demonstração marcada, com esta máquina ligada; não é hospedagem.

```bash
node deploy/backup.js backup     # antes de cada demonstração
node deploy/demo.js start        # sobe a pilha + túnel e mostra o endereço quando ele já responde
node deploy/demo.js status       # o túnel está no ar? em qual endereço?
node deploy/demo.js stop         # fecha o túnel; a pilha continua rodando localmente
```

Equivalente sem o script: `docker compose -f deploy/compose.yml -f deploy/compose.tunnel.yml up -d --wait`
e o endereço em `docker compose -f deploy/compose.yml -f deploy/compose.tunnel.yml logs tunnel`.

O que `deploy/compose.tunnel.yml` muda, só enquanto é usado:

- serviço `tunnel` (cloudflared 2026.9.3, fixado pelo digest, usuário não root) que encaminha para
  `http://web:3000` e nada mais. Fica em uma rede própria só com o web: **não alcança API, PostgreSQL
  nem Redis** e não publica porta nesta máquina;
- `TRUST_PROXY_HOPS=2` na API (navegador → Cloudflare → cloudflared → web → API). O `stop` recria a
  API com o valor de `deploy/.env` (1).

Nada muda em autenticação, permissões, isolamento entre restaurantes, cookies ou CORS: o navegador
fala com uma origem HTTPS só (o endereço do túnel) e chega à API pelo `/api` do web.

Medido em 2026-10-16 (dois túneis, abertos por cerca de 3 e 1 minuto e fechados):

- 55 verificações funcionais pelo endereço público (cadastro, login, cookie `Secure`/`HttpOnly`/
  `SameSite=Lax` sem `Domain`, refresh com rotação, cardápio público, pedido público, quadro da
  cozinha, PDV, isolamento entre restaurantes, logout) e 10 em navegador real com tela de celular
  (login pelo formulário, painel, pedidos, recarga mantendo a sessão, cozinha, cardápio): todas
  passaram.
- Endereço do cliente: as sessões abertas pelo túnel gravaram o IP público real desta máquina, também
  com `X-Forwarded-For` forjado (uma e duas entradas). `TRUST_PROXY_HOPS=2` está certo para este
  caminho.
- Pelo endereço público: `/api/health/*` e `/api/docs` respondem 404; rotas internas sem sessão, 401;
  `/_next/image` recusa endereço externo (400); HSTS, CSP com nonce e `X-Frame-Options: DENY`
  presentes. Depois do `stop`, o endereço antigo responde 530.

Cuidados:

- **Abra o endereço só depois que o `start` disser "ready".** Consultado antes de existir, o nome
  ficou marcado como inexistente no DNS do provedor desta máquina por mais de 3 minutos (medido). O
  `start` só consulta DNS público (1.1.1.1, 8.8.8.8) até o endereço responder. Se o celular disser que
  o site não existe, use os dados móveis em vez do Wi-Fi, ou espere alguns minutos.
- **Digite `https://`.** O túnel também responde em `http://`, e por `http` o navegador não guarda o
  cookie de sessão (`Secure`): o login não se mantém.
- **Feche ao terminar.** Enquanto o túnel está no ar, qualquer pessoa com o endereço chega à página de
  login e ao cadastro de restaurante, que é público.
- Os dados ficam nesta pilha (volume `pgdata`). Use o banco de homologação, nunca o de desenvolvimento.
- Com o túnel no ar, quem abrir `http://localhost:3000` **nesta máquina** consegue escolher o próprio
  endereço de cliente (`TRUST_PROXY_HOPS=2` sem o Cloudflare na frente). Só afeta esta máquina.

## Testes E2E em Linux

```bash
docker compose -f deploy/compose.yml --profile e2e run --rm e2e
```

Roda a suíte completa dentro de um container, contra um banco **separado** no PostgreSQL desta pilha
(`<POSTGRES_DB>_e2e`, criado na primeira execução). O banco em que você está testando o sistema não
recebe nada. A imagem vem de `deploy/api.e2e.Dockerfile`, um arquivo só de testes: ela cria
restaurantes, usuários e pedidos a cada execução e **nunca deve receber um banco em uso**.
Resultado em 2026-10-11: 46 suítes, 777 testes, 0 falhas.

## Usar as imagens em uma hospedagem

```bash
docker build -f deploy/api.Dockerfile         -t restaurant-saas-api .
docker build -f deploy/api.migrate.Dockerfile -t restaurant-saas-api-migrate .
docker build -f deploy/web.Dockerfile --build-arg API_URL=https://<api>/v1 -t restaurant-saas-web .
```

Nenhum dos três precisa de `--target`. O contexto de build é a raiz do repositório.

Variáveis, só os nomes:

- **API**: `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN`,
  `TRUST_PROXY_HOPS`, e opcionais `PORT`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`,
  `AUTH_RATE_LIMIT_PER_MINUTE`. `NODE_ENV=production` já vem na imagem.
- **Job de banco**: só `DATABASE_URL`, a mesma da API daquele ambiente.
- **Web**: `API_URL`, no **build** (argumento) e na execução. O endereço fica gravado no build: uma
  imagem do web serve para um endereço de API. Duas travas impedem que um web converse com a API de
  outro ambiente: `next build` falha sem `API_URL` (só o `next dev` mantém o padrão
  `localhost:4000`), e `node server.js` não sobe se `API_URL` faltar ou for diferente do endereço
  gravado no build (`apps/web/server/api-url-guard.js`); a mensagem diz com que `API_URL`
  recompilar. As imagens Docker já passam o mesmo valor nos dois momentos.

Saúde: API em `/health/live` (processo) e `/health/ready` (PostgreSQL + Redis), sem `/v1`. Os
Dockerfiles da API e do web já declaram `HEALTHCHECK`.

Ordem: a de "Migrations e seed". O job de banco roda antes da API e nunca no comando de início dela.

### O que depende de teste na plataforma

Nada disto foi executado em uma hospedagem. Antes de confiar em uma, conferir nela:

- qual estágio o construtor dela seleciona e qual comando de início o container realmente recebe
  (aqui: `node dist/src/main.js`);
- como apontar cada serviço para o seu Dockerfile dentro de `deploy/`, com a raiz do repositório
  como contexto;
- como rodar o job de banco **antes** da API e como a plataforma reage quando ele sai com código
  diferente de 0 (a versão anterior continua atendendo? a nova é barrada?);
- se um comando de início digitado na plataforma substitui o `CMD` da imagem, e o que acontece com
  o `ENTRYPOINT` herdado;
- se `API_URL` chega ao build do web como argumento;
- o valor de `TRUST_PROXY_HOPS` (seção abaixo).

## O que a imagem final contém

- Instalada com `NODE_ENV=production` e `pnpm install --prod`: **sem** devDependencies. Conferido na
  imagem da API: `typescript`, `@nestjs/cli`, `prisma` e `jest` ausentes.
- Compilação (`prisma generate`, `nest build`, `next build`) acontece em um estágio anterior, que tem
  as devDependencies e não vai para a imagem final.
- O cliente Prisma gerado para o sistema da imagem. Sem ele o build da imagem falha.
- A API compilada (`dist/`). Sem fontes, sem testes, sem `prisma/migrations` e sem o CLI do Prisma:
  a imagem da API não tem como aplicar migrations.
- Processo como usuário `node`, não root.
- Nenhum `.env` entra na imagem.
- Tudo isso é conferido por `node deploy/verify-images.js`.

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
  dos navegadores; não testado aqui). Teste em aparelhos pede um endereço com HTTPS: o túnel da seção
  "Demonstração pelo celular" fornece um.
- **Uma instância da API.** O limite de requisições é em memória.
- **A saúde da API não enxerga o schema.** `/health/ready` só confere se PostgreSQL e Redis
  respondem. Uma API iniciada contra um banco sem migrations fica "saudável" e responde `500` nas
  requisições (medido em 2026-10-11). O que garante a ordem é a implantação: o job de banco antes
  da API. Fazer a saúde conferir a versão do schema é uma decisão ainda não tomada.
- **Backup manual.** Existe `deploy/backup.js` (seção "Backup e restauração"), mas nada o executa
  sozinho, e os arquivos ficam no mesmo disco que o banco até alguém copiá-los para outro lugar.
- **`BIND_ADDRESS`**: mudar de `127.0.0.1` publica o web na rede. A API continua só em `127.0.0.1`,
  e PostgreSQL e Redis continuam sem porta publicada.
- **Tamanho das imagens**: API 531 MB, web 949 MB, job de banco 1,02 GB (traz todas as dependências
  de build, porque o CLI do Prisma é uma delas). Não foram otimizadas.
- A API encerra com código 143 no `stop`: o Nest termina as requisições em andamento, desconecta do
  banco e reenvia o sinal recebido.
