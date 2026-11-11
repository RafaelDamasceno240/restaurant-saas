# Integração do novo cardápio (Brendi) no DEV

Data: 11/11/2026, à noite. Autorização: prompt "INTEGRAÇÃO OFICIAL DO NOVO CARDÁPIO BRENDI"
(merge local, backups, testes, migration segura e importação no DEV sob condições). Sem push, sem
deploy, sem tocar em master, produção, homologação, piloto, demo ou no ambiente acadêmico FINAL.

**Resumo:** o código foi integrado (merge local `695f312`) e a migration 21 foi aplicada ao DEV
depois de validada numa cópia restaurada do backup. Os testes passaram: unitários 448 + 444 + 14,
E2E 952/952, navegador. O DEV está no ar em 3100/4100 com o código novo. **A importação do
cardápio da Do'cê no DEV ficou PENDENTE**: existe no DEV um produto feito à mão, "Burger Bacon", com
o mesmo nome de um produto da Brendi, e a regra é não sobrescrever cadastros existentes sem a sua
decisão. A importação completa foi testada numa cópia descartável do DEV (fidelidade 723/723).

## 1. Branches integradas

| | |
| --- | --- |
| Destino | `salto-desenvolvimento` (worktree `restaurant-saas`), antes em `16bd3b0` |
| Origem | `cardapio-brendi` (worktree `restaurant-saas-cardapio`), `84c325e` (aprovado) |
| Base comum | `16bd3b0`: a `cardapio-brendi` saiu da ponta da `salto-desenvolvimento`, sem divergência |
| Conflitos | Nenhum. A árvore do merge é **idêntica** à de `84c325e` (`git diff 84c325e HEAD` vazio): nada dos módulos anteriores foi perdido |
| Commits trazidos | `f417823` (adicionais, mídia, cardápio novo, importador), `a6c3d0a` (marca por restaurante, revisão), `84c325e` (administração pelo painel, proteção da importação, guardas de API_URL) |
| master | Intocada (`a23be9a` = `origin/master`). Nada foi enviado |

## 2. Commit do merge local

`695f312` — "Merge branch 'cardapio-brendi' into salto-desenvolvimento" (`--no-ff`, histórico
preservado). Este relatório entra num commit seguinte, também local.

Pontos de recuperação do Git:

- tag `backup/salto-desenvolvimento-antes-cardapio-20261111_194104` → `16bd3b0`
- tag `backup/cardapio-brendi-aprovado-20261111_194104` → `84c325e`
- bundle `restaurant-saas-backups/codigo/salto-e-cardapio_20261111_194104.bundle` (as duas branches;
  `git bundle verify` ok; sha256 `be924fad…a17d`)

Para voltar ao estado anterior do código: `git reset --hard backup/salto-desenvolvimento-antes-cardapio-20261111_194104`
na `salto-desenvolvimento` (só se pedido; a migration 21 no banco é aditiva e não atrapalha o código antigo).

## 3. Backup do DEV e teste de restauração

| | |
| --- | --- |
| Arquivo | `Desktop/Projetos/restaurant-saas-backups/dev/restaurant_saas_dev_20261111_194135_antes_integracao_cardapio_migration_21.dump` |
| Formato | `pg_dump -Fc` (PostgreSQL 16.15), 2.441.335 bytes |
| sha256 | `a806d711d243c1da13e09d44b75a710d492e0f9da989c7767765fd258de53482` (também em `.sha256` ao lado) |
| Identidade do banco | `restaurant_saas`, system identifier `7690370053421789218` (o mesmo de sempre do DEV) |
| Restauração | Em container descartável `rs-integ-pg` (127.0.0.1:55460, banco `restaurant_saas_copia`), `pg_restore --exit-on-error`: ok |
| Conferência | **51/51 tabelas com contagem e md5 de todas as linhas idênticos** ao DEV; schema idêntico (`pg_dump --schema-only`) |

Backups anteriores preservados (nenhum apagado ou sobrescrito).

## 4. Migration 21 (`20261110210000_menu_options_and_media`)

O SQL só acrescenta: 5 tabelas (`option_groups`, `option_items`, `product_option_groups`,
`media_assets`, `order_item_options`), colunas novas que aceitam nulo ou têm padrão, chaves
estrangeiras e CHECKs. Não tem DROP, RENAME ou UPDATE.

**Na cópia (primeiro):** `prisma migrate deploy` → 21/21. Resultado:
- todas as 51 tabelas anteriores mantidas, agora 56;
- dados das colunas antigas idênticos nas 50 tabelas (só `_prisma_migrations` mudou, por ganhar a
  linha da 21);
- schema: +236 linhas, nenhuma removida (3 linhas só ganharam vírgula por virem colunas depois);
- 0 restrições não validadas; drift 0 (`prisma migrate diff`);
- compatibilidade: a API integrada sobre a cópia respondeu **31/31** rotas de leitura dos módulos
  anteriores com os dados antigos (pedidos, mesas, comandas, caixa, clientes, cupons, fidelidade,
  cashback, fiado, fornecedores, compras, estoque, receitas, entrega, 6 relatórios, perfil,
  usuários) e o cardápio público.

**No DEV (depois):** conferido antes que o DEV não tinha mudado desde o backup (fingerprint
idêntico) e que não havia conexões abertas. `prisma migrate deploy` (sem reset, sem db push) →
**21/21**. Depois: dados antigos idênticos, 56 tabelas, schema **igual ao da cópia validada**, drift
0. Nenhuma linha existente foi alterada.

## 5. Restaurante utilizado

| | |
| --- | --- |
| Tenant | `0c995069-39d8-4257-96ab-ef61efe80ef3`, slug `doce-hamburgueria`, "Do'cê Hamburgueria e Confeitaria" |
| Como foi identificado | Único tenant do DEV (entre 2.063, quase todos de testes) com nome ou slug parecido com Do'cê/doce/hamburg; dono `rafaeloliveiradamasceno@gmail.com`; unidade "Matriz" (`279c5b67…`) |
| O que já existia | 1 categoria feita à mão, "lanche b", com 1 produto, "Burger Bacon", R$ 26,00, sem descrição nem foto, criado em 29/09/2026. Nenhum pedido. Unidade sem horários, endereço ou WhatsApp, taxa 0 |

O destino é inequívoco. **A importação não foi aplicada no DEV** por causa do conflito do item 7.

## 6. Quantidades

Fonte: `importacao-brendi/dados/cardapio.json` (capturado da Brendi em 10/11/2026) e as 80 fotos em
`restaurant-saas-cardapio/importacao-brendi/imagens/` (fora do Git, conferidas: 80 arquivos, 15 MB).

| | Fonte | Simulação no DEV | Aplicado na cópia do DEV |
| --- | --- | --- | --- |
| Categorias com produtos | 9 (+2 vazias, não importadas) | criar 9 | 9 (+ "lanche b" preservada) |
| Produtos | 78 | criar 77, **conflito 1** | 78 (77 novos + "Burger Bacon" adotado) |
| Grupos de adicionais | 2 | criar 2 | 2 |
| Adicionais | 27 | criar 27 | 27 |
| Fotos de produto | 75 produtos com foto (3 sem foto na Brendi) | 77 imagens válidas | 75 produtos com foto |
| Esgotados | 9 | — | 9 |
| Loja (`--incluir-loja`) | horários, WhatsApp, endereço, taxa R$ 3,00, grátis acima de R$ 23,00, mínimo R$ 21,00, logo e capa | alteraria 11 campos (hoje vazios ou zero no DEV) + logo e capa | aplicado |

## 7. Duplicatas e conflitos

- **1 conflito: "Burger Bacon".** No DEV é feito à mão (R$ 26,00, categoria "lanche b"); na
  Brendi custa R$ 30,00, está em "Burgers Especias" e tem descrição, foto e adicionais. O importador
  **recusa gravar** enquanto houver conflito (saída 1, nada gravado), e a regra deste trabalho proíbe
  sobrescrever o produto manual sem decisão. Relatório da simulação:
  `importacao-brendi/execucoes/17-dev-simulacao-integracao.json`.
- Nenhum outro conflito: categorias, grupos e adicionais não têm homônimos no DEV. Não há
  identificadores repetidos, porque os `externalId` são novos (coluna criada pela migration 21).
- Os dados da loja não são conflito de nome, mas também **sobrescreveriam** campos da unidade.
  Hoje esses campos estão vazios, mas incluir a loja precisa da sua decisão.

## 8. Fidelidade

- **DEV:** não se aplica, porque a importação está pendente.
- **Cópia do DEV com a importação aplicada:** `conferir-fidelidade.mjs` → **723/723** verificações:
  preço, preço "de", esgotado, categoria, descrição, foto, destaque e adicionais de cada produto,
  regras dos grupos e contagem. Relatório da aplicação na cópia:
  `importacao-brendi/execucoes/18-copia-dev-aplicacao-adotando.json`.

## 9. Testes unitários (código integrado, worktree `restaurant-saas`)

| | Resultado |
| --- | --- |
| API (jest) | **448/448** (45 suítes) |
| Web (jest) | **444/444** (42 suítes, inclui as guardas de API_URL) |
| deploy (`node --test`) | **14/14** |
| Typecheck API e web | ok |
| Lint API e web | ok, sem avisos |
| Build API (`nest build`) | ok |
| Build web | ok, com `API_URL=http://127.0.0.1:4100/v1` (destino gravado no build conferido) |

## 10. Suíte E2E

Banco descartável `rs_integ_e2e` no container `rs-cardapio-pg` (127.0.0.1:55442; o script recusa
qualquer outro banco), migrations + seed do zero: **64/64 suítes, 952/952 testes**, 419 s. Cobre
autenticação, permissões, isolamento entre restaurantes, cardápio público, preços e adicionais,
estoque, pedidos, cozinha, mesas e comandas, PDV e caixa, relatórios e Super Admin. O banco foi
apagado ao fim (criado nesta sessão). **Nenhum E2E rodou no DEV.**

## 11. Navegador (Chrome headless, celular 390×844 e computador 1440×900)

Na **cópia do DEV com o cardápio importado** (web 3100 → API 4100 ligada à cópia,
temporariamente; loja aberta só na cópia e horário original devolvido depois):

| Roteiro | Resultado |
| --- | --- |
| Cardápio público: lista, destaques, busca, produto com nome e descrição longos, esgotado, combo com adicional obrigatório, adicionais, observação, carrinho, checkout (entrega, cupom inválido, pedido mínimo), pedido feito e acompanhamento, carrinho vazio, produto e restaurante inexistentes | **6/6** checagens, acessibilidade ok nas 20 telas, 38 capturas |
| Pedido de teste (cópia) | gravado como ONLINE: Burger Tudo + Bacon ×2 + Ovo + observação = R$ 44,00, com os adicionais congelados em `order_item_options` |
| Painel: produtos (fotos importadas, promoção, foto nova, esgotado, ordem), adicionais (criar grupo, vincular, aviso de obrigatório sem opção), identidade (cor com aviso de contraste, capa com prévia), reflexo no cardápio público, telas no celular sem rolagem lateral | **18/18**. Uma checagem acusou falha por erro de escape no script de teste, e a reconferência na própria tela passou: R$ 36,00 com "de" R$ 39,90 riscado e foto nova |
| Marca por restaurante: Do'cê com o próprio logo, outro restaurante com as próprias iniciais e sem nada da Do'cê (painel e perfil, celular e computador) | **8/8** |
| Cardápio público de outros restaurantes (`tenant-1790557114775-…`, `burger-dev-…`) | sem nome, logo ou imagem da Do'cê |

No **DEV real** (só leitura, sem login de conta real e sem pedido):

| | Resultado |
| --- | --- |
| API 4100 `/health/ready` | ok (Postgres e Redis do DEV) |
| `/menu/doce-hamburgueria`, `/menu/burger-dev-…`, `/login` em celular e computador | **6/6**: sem rolagem lateral, sem erros no console, sem marca da Do'cê no outro restaurante |
| `/dashboard/cardapio` sem login | 307 → login |
| `/api/auth/me` sem login; login com conta inexistente | 401; 401 |
| DEV depois dos testes | fingerprint das colunas antigas idêntico ao de logo após a migration (nenhuma escrita) |

**API_URL do web DEV:** o build grava `http://127.0.0.1:4100/v1` no proxy `/api`, e o `server.js`
confere esse destino ao iniciar (recusa iniciar se o `API_URL` for outro ou faltar). O
`apps/web/.env` ainda tem um `NEXT_PUBLIC_API_URL=http://localhost:4000/v1` antigo, que **não é
usado pelo código** (4000 é a API da homologação). A API 4100 confirmou 1 conexão no banco DEV e
nenhuma na cópia.

Observação: depois da troca da API 4100 da cópia para o DEV, uma aba do Chrome de teste ainda aberta
mandou 2 requisições com sessão da cópia (`GET /orders`, `POST /auth/refresh`). O DEV respondeu
**401** a ambas e não gravou nada (conferido pelo fingerprint). O Chrome foi fechado.

## 12. URLs

| | |
| --- | --- |
| Web DEV | http://localhost:3100 |
| API DEV | http://localhost:4100/v1 (saúde: http://localhost:4100/health/ready) |
| Cardápio público da Do'cê | http://localhost:3100/menu/doce-hamburgueria |
| Painel do cardápio | http://localhost:3100/login → **Cardápio** (abas Produtos e Adicionais) |
| Identidade visual | Painel → **Restaurante** → editar identidade (logo, capa, cor) |

Entrar com a conta de dono da Do'cê no DEV (a sua; a senha não foi alterada nem vista).

Os dois serviços foram iniciados por esta sessão (processos `node`, não containers) e param quando
ela terminar. Para subir de novo:

```
# API (lê apps/api/.env do DEV; a porta e a origem vêm da linha de comando)
cd apps/api && PORT=4100 CORS_ORIGIN=http://localhost:3100 TRUST_PROXY_HOPS=1 node dist/src/main.js
# Web (o build atual foi feito para este endereço; o servidor recusa outro)
cd apps/web && NODE_ENV=production PORT=3100 API_URL=http://127.0.0.1:4100/v1 node server.js
```

## 13. Pendências

1. **Importar o cardápio da Do'cê no DEV: precisa da sua decisão sobre o "Burger Bacon"**:
   - (a) **adotar**: o produto manual passa a ser o da Brendi (R$ 30,00, descrição, foto,
     adicionais, categoria "Burgers Especias"); o id é mantido. Foi o que se testou na cópia;
   - (b) **manter os dois**: renomear o manual no painel (ex.: "Burger Bacon (antigo)") e importar;
   - (c) **excluir** o manual no painel e importar.

   Também é preciso decidir **incluir ou não os dados da loja** (horários, WhatsApp, endereço, taxas,
   logo e capa; hoje vazios no DEV). Com a decisão, fazem-se um novo backup, a simulação e depois:
   ```
   cd apps/api && pnpm menu:import --arquivo ../../importacao-brendi/dados/cardapio.json \
     --imagens ../../../restaurant-saas-cardapio/importacao-brendi/imagens \
     --restaurante doce-hamburgueria [--adotar-por-nome] [--incluir-loja] \
     --aplicar --confirmar-banco restaurant_saas --confirmar-restaurante doce-hamburgueria \
     --relatorio ../../importacao-brendi/execucoes/19-dev-aplicacao.json
   ```
   Em seguida rodar `conferir-fidelidade.mjs` contra `http://localhost:4100/v1`. O relatório
   permite `--desfazer`.
2. **Adicionais no PDV e nas comandas** e relatório de vendas por adicional (P3, fora deste escopo):
   o PDV e as comandas ainda vendem pelo preço base.
3. **Fotos dentro do banco** (`media_assets`): adequado para logo, capa e cerca de 80 fotos; para
   muito mais, um armazenamento de arquivos.
4. **Integração a master, push e deploy:** não autorizados nesta etapa. Lembrete: push para master
   publica em produção automaticamente.
5. **Cópia descartável `rs-integ-pg`** (127.0.0.1:55460) mantida para você comparar, se quiser, o
   DEV com o cardápio já importado. Pode ser removida quando não for mais útil
   (`docker rm -f rs-integ-pg`); não é backup, o backup é o `.dump`.
6. O pedido real pela Brendi nunca foi observado (a loja estava fechada na extração). O fluxo de
   pedido do sistema foi testado na cópia.

## 14. Ambiente acadêmico

Intacto: worktree `restaurant-saas-final` em `e04d4a7`, sem nenhuma alteração; containers
`restaurant-saas-final-*` saudáveis e sem reinício; web 3600 responde. O banco
`restaurant_saas_final` não foi acessado. O PowerPoint, a homologação (3000/4000), o piloto
(3500/4500), a demo (3300/4300) e master não foram tocados. A worktree `restaurant-saas-cardapio`
foi preservada (`84c325e`, sem alterações).
