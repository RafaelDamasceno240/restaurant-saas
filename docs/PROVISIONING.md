# Provisionamento de restaurantes (CLI administrativo)

O Restaurant SaaS não tem cadastro público (desde 2026-10-28): um restaurante só passa a existir
quando é vendido e alguém da equipe o cria. Essa criação é feita por um **comando local**,
`tenant:provision`, executado por quem tem acesso ao banco de dados (o `DATABASE_URL`).

- Não existe rota HTTP **pública** para isso. O comando sobe só o necessário (Prisma e o registro
  de auditoria): não abre porta, não usa Redis nem os segredos de JWT.
- Desde 2026-10-28 há uma segunda interface para o **mesmo** serviço: o painel da plataforma,
  `/super-admin` → Restaurantes → Novo restaurante (docs/SUPER_ADMIN.md), só para administradores da
  plataforma. Painel e comando seguem a mesma regra de negócio; o painel grava também
  `PLATFORM_TENANT_CREATED` com o administrador que criou.
- A regra de criação é uma só: `TenantProvisioningService`
  (`apps/api/src/modules/tenants/tenant-provisioning.service.ts`). O comando
  (`apps/api/src/cli/provision-tenant.ts`) só pergunta, mostra, confirma e chama esse serviço.
- Nada é gravado antes de o operador ver o banco alvo e confirmar.

## O que é criado

Tudo numa única transação: se qualquer parte falhar, nada fica gravado.

| Item | Valor inicial |
| --- | --- |
| Restaurante (tenant) | nome, razão social, CNPJ/CPF e slug informados; status `TRIAL`; fuso `America/Sao_Paulo` |
| Unidade principal | nome informado, código `MATRIZ`, status `ACTIVE`, **delivery desligado** |
| Conta do proprietário | nome, e-mail e senha inicial informados; status `ACTIVE`; papel `OWNER` (todas as permissões do dono, vindas do seed) |
| Acesso à unidade | o OWNER fica ligado à unidade principal |
| Auditoria | `TENANT_PROVISIONED`, com slug, e-mail do OWNER e quem rodou o comando (`usuário@máquina`) |

O delivery começa desligado de propósito (B11): o dono define taxa e pedido mínimo e liga em
Delivery → Configurações de entrega. O comando não abre sessão: o OWNER entra pelo login normal.

## Pré-requisitos

- Dependências instaladas (`pnpm install` na raiz).
- No banco alvo: migrations aplicadas e seed executado (`pnpm --filter api prisma:deploy` e
  `pnpm db:seed`, ou `node deploy/migrate.js release`). Sem o seed não existe o papel `OWNER`.
- O `DATABASE_URL` do banco onde o restaurante deve ser criado.

## Qual banco será usado

O comando usa, nesta ordem:

1. a variável de ambiente `DATABASE_URL`, se estiver definida;
2. senão, o arquivo `.env` da pasta onde ele roda (`apps/api/.env` quando se usa os scripts abaixo).

Antes de perguntar qualquer coisa ele diz de onde leu e qual é o alvo, e antes de criar mostra:

```
Confira antes de criar:
  Banco:                  PostgreSQL 16.x
  Host:                   localhost:5432
  Database:               restaurant_saas
  Ambiente:               development (NODE_ENV)
  Restaurantes no banco:  2063
  Restaurante:            ...
  Slug:                   ...
  E-mail OWNER:           ...
  Senha inicial:          (informada, não exibida)
```

Usuário e senha do banco nunca aparecem. **Não confie só no "Ambiente"** (é apenas o `NODE_ENV`):
confira host, database e a quantidade de restaurantes que já existem nele. Para criar em outro
banco, defina `DATABASE_URL` antes de rodar.

## Modo interativo (recomendado)

Da raiz do repositório:

```bash
pnpm tenant:provision
```

(também funciona `npm run tenant:provision`, ou `pnpm tenant:provision` dentro de `apps/api`.)

O comando pergunta, em ordem: nome do restaurante, razão social, CNPJ/CPF (pode ter pontos e
traços; eles são removidos), slug, unidade principal, nome do proprietário, e-mail, senha inicial e
confirmação da senha. Cada pergunta vem com uma explicação curta e um exemplo, e a resposta é
digitada na linha `> `:

```
Slug
Identificador usado na URL. Sem espaços, acentos ou caracteres especiais: só letras minúsculas, números e hífen.
Exemplo: restaurante-central
> 
```

**A senha não aparece enquanto é digitada** (o exemplo dela é só uma orientação, nunca uma senha).
Depois mostra o resumo e pede:

```
Banco alvo: restaurant_saas em localhost:5432. Digite CRIAR para continuar:
```

Qualquer resposta diferente de `CRIAR` (inclusive `criar`, vazio ou Ctrl+C) cancela, e nada é
criado.

## Modo não interativo (automação)

Todos os dados podem vir por opção. A senha **nunca** vai por opção (ficaria no histórico do
terminal, na lista de processos e até na mensagem de erro do pnpm): ela vem de `OWNER_PASSWORD`,
ou é perguntada. Opções que pareçam senha (`--password`, `--senha`...) são recusadas.

| Opção | Dado |
| --- | --- |
| `--tenant-name` | nome do restaurante |
| `--legal-name` | razão social |
| `--document` | CNPJ/CPF |
| `--slug` | slug (endereço do cardápio) |
| `--branch-name` | unidade principal |
| `--owner-name` | nome do proprietário |
| `--email` | e-mail do proprietário |
| `--confirm-database <nome>` | confirma o banco pelo nome, em vez de digitar CRIAR |
| `--debug` | mostra o detalhe técnico de um erro inesperado |
| `--help` | ajuda |

Dado que faltar nas opções é perguntado. Com `--confirm-database`, o nome informado precisa ser
exatamente o do banco conectado; se não for, nada é criado (saída 2).

Bash (a senha é lida sem eco e não fica no histórico):

```bash
read -rs -p 'Senha inicial: ' OWNER_PASSWORD; echo; export OWNER_PASSWORD
pnpm tenant:provision -- \
  --tenant-name "Restaurante X" \
  --legal-name "Restaurante X LTDA" \
  --document "12345678000199" \
  --slug "restaurante-x" \
  --branch-name "Matriz" \
  --owner-name "João" \
  --email "joao@example.com"
unset OWNER_PASSWORD
```

PowerShell:

```powershell
$s = Read-Host 'Senha inicial' -AsSecureString
$env:OWNER_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
pnpm tenant:provision -- `
  --tenant-name "Restaurante X" `
  --legal-name "Restaurante X LTDA" `
  --document "12345678000199" `
  --slug "restaurante-x" `
  --branch-name "Matriz" `
  --owner-name "João" `
  --email "joao@example.com"
Remove-Item Env:OWNER_PASSWORD
```

Para rodar em outro banco nessa mesma janela, defina antes `DATABASE_URL` (Bash:
`export DATABASE_URL=...`; PowerShell: `$env:DATABASE_URL = '...'`) e remova depois.

## Em produção / na stack Docker

A imagem da API já contém o comando compilado (a partir do build que incluir esta mudança). Com o
`DATABASE_URL` do próprio container:

```bash
docker compose -f deploy/compose.yml exec api node dist/src/cli/provision-tenant.js
```

Num checkout com o build da API pronto (`pnpm --filter api build`): `pnpm --filter api
tenant:provision:prod`. A confirmação `CRIAR` (ou `--confirm-database`) vale igual.

## Códigos de saída

| Código | Significado |
| --- | --- |
| 0 | restaurante criado |
| 1 | recusado: cancelado, dados inválidos, senhas diferentes, slug/CNPJ/e-mail já usados, erro ao criar |
| 2 | comando ou ambiente errado (opção desconhecida, senha como opção, `DATABASE_URL` ausente, banco inacessível, `--confirm-database` diferente); nada foi tentado |

## Erros comuns

| Mensagem | O que fazer |
| --- | --- |
| `Já existe um restaurante com o slug "..."` | escolha outro slug (é o endereço do cardápio: `/menu/<slug>`) |
| `Já existe um restaurante com este CNPJ/CPF.` | o cliente já foi criado; confira antes de criar de novo |
| `Já existe uma conta com o e-mail "..."` | o e-mail é o login e é único entre todos os restaurantes; use outro |
| `Dados inválidos` | slug só com minúsculas, números e hífens; CNPJ com 14 ou CPF com 11 dígitos; senha com 8+ caracteres; e-mail válido |
| `DATABASE_URL não está definido...` | defina `DATABASE_URL` ou rode de `apps/api`, onde está o `.env` |
| `Não foi possível conectar ao banco ...` | banco desligado ou URL errada; `--debug` mostra o detalhe |
| `A senha não é aceita como opção...` | use `OWNER_PASSWORD` ou deixe o comando perguntar |

Erros esperados não mostram stack trace; um erro inesperado mostra só com `--debug`.

## Depois de criar: como o dono entra

O comando termina com o endereço de acesso, tirado da configuração (`CORS_ORIGIN`, a origem do
web):

```
Restaurante criado com sucesso.

Restaurante: Restaurante X
Slug: restaurante-x
Unidade: Matriz
OWNER: joao@example.com
Status: TRIAL
Fuso horário: America/Sao_Paulo
Delivery: desligado

Acesso:
http://localhost:3000/login
```

Passe ao dono o endereço, o e-mail e a senha inicial por um canal seguro (nunca junto no mesmo
lugar público). Ele entra em `/login`, troca a senha em **Trocar senha** no painel e cadastra a
equipe em Usuários. O cardápio público fica em `/menu/<slug>`.

## Testes

- `apps/api/src/cli/provision-tenant.cli.spec.ts`: opções, banco alvo, confirmação, senha fora da
  saída e do eco do terminal, erros sem stack trace.
- `apps/api/test/provision-tenant-cli.e2e-spec.ts`: o comando rodado de verdade num banco
  descartável (interativo e automação), duplicidades, cancelamento, falha no meio sem dado
  parcial, auditoria na mesma transação, criação simultânea e ausência de rota HTTP.
