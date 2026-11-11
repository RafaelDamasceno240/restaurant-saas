# Integração do novo cardápio (Brendi) no DEV

Data: 11/11/2026, à noite. Autorização: prompt "INTEGRAÇÃO OFICIAL DO NOVO CARDÁPIO BRENDI"
(merge local, backups, testes, migration segura e importação no DEV sob condições). Sem push, sem
deploy, sem tocar em master, produção, homologação, piloto, demo ou no ambiente acadêmico FINAL.

**Resumo:** o código foi integrado (merge local `695f312`) e a migration 21 foi aplicada ao DEV
depois de validada numa cópia restaurada do backup. Os testes passaram: unitários 448 + 444 + 14,
E2E 952/952, navegador. O DEV está no ar em 3100/4100 com o código novo.

**Atualização (11/11, 20h28): a importação da Do'cê no DEV foi CONCLUÍDA** (seção 15). O "Burger
Bacon" foi adotado por decisão sua. Os dados da loja foram mantidos.

As seções 5 a 8 e o item 1 das pendências descrevem o estado anterior, quando a importação ainda
dependia da sua decisão.

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

1. ~~Importar o cardápio da Do'cê no DEV~~ **Resolvido na seção 15** (adoção escolhida por você,
   loja mantida). Texto original:
   **Importar o cardápio da Do'cê no DEV: precisa da sua decisão sobre o "Burger Bacon"**:
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

## 15. Importação da Do'cê no DEV (concluída em 11/11/2026, 20h28)

Pedido: prompt "FINALIZAR IMPORTAÇÃO DA DO'CÊ NO DEV". Sem repetir o merge, a migration ou o E2E
completo.

### 15.1 Burger Bacon: comparação e decisão

| | Manual no DEV | Brendi |
| --- | --- | --- |
| ID | `2902d5a7-a82c-4b0c-a906-a66f143f328b` | origem `ef8UEWdMyRdhOBeDYsQ9` |
| Nome | Burger Bacon | Burger Bacon |
| Descrição / ingredientes | nenhuma | Pão brioche, hambúrguer 160g, mussarela, fatias de bacon crocante, molho especial |
| Preço | R$ 26,00 | R$ 30,00 ("a partir de") |
| Categoria | "lanche b" (feita à mão) | Burgers Especias |
| Foto | nenhuma | sim |
| Adicionais | nenhum (não existiam antes da migration 21) | grupo "Turbine seu lanche!" |
| Pedidos (`order_items`) | 0 | — |
| Comandas | **1 comanda ABERTA** desde 10/11 13:06, com 1 unidade enviada à cozinha a R$ 26,00 | — |
| Receita / estoque | nenhuma | — |

O nome é igual, mas preço, categoria e descrição não permitem provar que é o mesmo produto. Por
isso **não adotei sozinho e pedi sua decisão. Você escolheu adotar.**

Antes de aplicar, conferi no código:
- a adoção atualiza o produto **pelo mesmo ID** (`tx.product.update`) e guarda os valores
  anteriores no relatório, para `--desfazer`;
- a comanda fecha pelo preço congelado no item (`unitPriceCentsSnapshot`), não pelo preço atual do
  produto.

Resultado no DEV: mesmo ID, R$ 30,00, categoria Burgers Especias, foto e 1 grupo de adicionais. O
item da comanda aberta continua **R$ 26,00**: a comanda e os itens estão idênticos byte a byte. A
categoria "lanche b" ficou vazia e **não foi apagada**.

### 15.2 Dados da loja: diferenças (MANTIDOS os do DEV)

| Campo | DEV (mantido) | Brendi |
| --- | --- | --- |
| WhatsApp | vazio | preenchido (número público da loja) |
| Endereço | vazio | Rua Santa Catarina, 70, Centro, Ilicínea-MG, 37175-000 (ref.: próximo à padaria Central) |
| Horários | sem horários | qui 19:00–22:30, sex 19:00–23:00, sáb 19:00–22:45, dom 19:00–22:45 |
| Taxa de entrega | R$ 0,00 (o cardápio mostra "Grátis") | R$ 3,00 |
| Raio de entrega | o SaaS não tem raio | faixas 0–5 km e 5–10 km, mesma taxa, 30–40 min |
| Entrega grátis a partir de | não definido | R$ 23,00 |
| Pedido mínimo | R$ 0,00 | R$ 21,00 |
| Retirada | disponível | disponível, 50–60 min |
| Logo, capa, cor | nenhum (o cardápio mostra a inicial "D") | logo e capa da Brendi |
| Pagamentos, agendamento | regras do SaaS | Pix e cartão online; dinheiro e cartão na entrega; agendamento até 8 dias |

O importador só troca a loja **inteira** (`--incluir-loja`: logo, capa, horários, WhatsApp, endereço,
taxas e mínimo, tudo junto). Não há como escolher campo por campo. Como nenhum campo estava
autorizado, **a importação foi feita sem `--incluir-loja`**. A unidade e o restaurante ficaram
idênticos ao backup (md5 da linha conferido).

### 15.3 Antes de gravar

| | |
| --- | --- |
| Backup novo (pós-migration 21) | `restaurant-saas-backups/dev/restaurant_saas_dev_20261111_202726_antes_importacao_doce.dump`, sha256 `ec6638d5…2489`; restaurado em banco descartável: **56/56 tabelas idênticas** |
| Tenant | `doce-hamburgueria` (`0c995069…`), único plausível; dono confirmado |
| Simulação sem adoção | 1 conflito (Burger Bacon), nada mais (`execucoes/19-dev-simulacao.json`) |
| Simulação com adoção | criar 9 categorias, 2 grupos, 27 adicionais e 77 produtos; adotar 1; 0 conflitos (`execucoes/19-dev-simulacao-adotando.json`) |
| Opções usadas | `--adotar-por-nome --aplicar --confirmar-banco restaurant_saas --confirmar-restaurante doce-hamburgueria`. **Sem** `--sobrescrever-edicoes` e **sem** `--incluir-loja` |

Relatório da aplicação: `importacao-brendi/execucoes/20-dev-aplicacao.json` (fora do Git; guarde-o).
Para desfazer:

```
cd apps/api && pnpm menu:import --restaurante doce-hamburgueria \
  --desfazer ../../importacao-brendi/execucoes/20-dev-aplicacao.json \
  --aplicar --confirmar-banco restaurant_saas --confirmar-restaurante doce-hamburgueria
```

### 15.4 Depois de gravar

| Verificação | Resultado |
| --- | --- |
| Produtos | **78** (todos ligados à Brendi; 77 novos + Burger Bacon adotado) |
| Categorias com produtos | **9** (+ "lanche b" vazia, preservada) |
| Grupos / adicionais | **2 / 27**; 30 vínculos produto↔grupo |
| Fotos | **75** produtos com foto, 75 imagens no banco (3 produtos não têm foto na Brendi: Água sem gás, Água com gás e Suco latinha pêssego) |
| Esgotados / preço "de" / destaques | 9 / 2 / 5, iguais à fonte (fidelidade) |
| Duplicatas | 0 nomes repetidos, 0 `externalId` repetidos |
| Tabelas alteradas | só `categories`, `products`, `option_groups`, `option_items`, `product_option_groups`, `media_assets` e 1 linha em `audit_logs` (`MENU_IMPORTED`) |
| Pedidos e comandas antigos | comanda aberta e itens idênticos; 0 pedidos da Do'cê antes e depois |
| Isolamento | dados de **todos os outros restaurantes idênticos nas 56 tabelas** (md5 de cada linha); os cardápios públicos de `burger-dev-…` e `tenant-1790557114775-…` não têm produtos nem logo da Do'cê |

### 15.5 Validação

| Teste | Resultado |
| --- | --- |
| Fidelidade Brendi → SaaS (`conferir-fidelidade.mjs` na API do DEV) | **718/723**. Todo o cardápio confere: preço, "de", esgotado, categoria, descrição, foto, destaque, adicionais, regras dos grupos e contagem. As 5 diferenças são os dados da loja mantidos de propósito: taxa, mínimo, grátis a partir de, logo e capa |
| Navegador no DEV, celular e computador: cardápio, busca, produto (nome e descrição longos), esgotado, combo com adicional obrigatório, adicionais com quantidade, observação, carrinho, checkout (entrega, Pix, cupom inválido), carrinho vazio, produto e restaurante inexistentes | **8/8**, acessibilidade ok nas 18 telas. **O pedido não foi enviado**: o formulário foi preenchido e o botão "Confirmar pedido" conferido, sem clicar. Pedidos no DEV: 668 antes e 668 depois |
| Foto servida pelo web (`/api/public/media/…`) | 200 image/jpeg |
| Administração de produtos e de adicionais **no DEV** | **Não executada**: exige entrar com a sua conta, e a sua senha não foi usada nem alterada. A mesma tela, com o mesmo código, passou 18/18 na cópia do DEV (seção 11) e nos E2E |

### 15.6 Pendências depois da importação

1. **Entrar no painel e conferir** Cardápio → Produtos e Adicionais com a sua conta:
   http://localhost:3100/login.
2. **Dados da loja**: o cardápio do DEV mostra entrega grátis e sem pedido mínimo, porque esses
   campos estão vazios. Para usar os valores reais, preencha no painel (Delivery para taxa, mínimo e
   grátis a partir de; Restaurante para horários, endereço, WhatsApp, logo, capa e cor). A outra
   opção é autorizar `--incluir-loja`, que troca tudo de uma vez e grava os valores anteriores no
   relatório.
3. **Comanda aberta desde 10/11** (mesa, 1 Burger Bacon a R$ 26,00): era um teste seu? Feche ou
   cancele pelo painel quando quiser. Não mexi nela.
4. **Categoria "lanche b"** ficou vazia: pode ser excluída ou desativada no painel, se não for mais
   usada.
5. As pendências 2 a 6 da seção 13 continuam: adicionais no PDV e nas comandas, fotos no banco,
   master/push/deploy e a cópia `rs-integ-pg`.
