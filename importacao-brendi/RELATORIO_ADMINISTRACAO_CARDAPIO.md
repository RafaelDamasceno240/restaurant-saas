# Administração do cardápio pelo painel — relatório (11/11/2026)

Worktree `restaurant-saas-cardapio`, branch `cardapio-brendi`, a partir do commit `a6c3d0a`. Tudo
foi feito e testado só com bancos descartáveis (container `rs-cardapio-pg`). Não houve merge, push
nem deploy. DEV, homologação, piloto, demo, o ambiente final acadêmico e o PowerPoint não foram
tocados. **Não há migration nova:** tudo usa as colunas da migration 21, que já existia nesta branch
(e só em bancos descartáveis).

Objetivo: o proprietário administra o cardápio inteiro pelo painel, sem código, scripts ou
desenvolvedor.

## 1. O que já existia (etapa 1) e foi preservado

| Tela / API | Já fazia | Mantido |
| --- | --- | --- |
| `/dashboard/cardapio` (`MenuAdmin`) | categorias e produtos: criar, editar, pausar, duplicar, excluir, busca, filtro, botões conforme o papel (B12) | tudo; ganhou os campos e ações novos |
| `/dashboard/restaurante` | perfil, contatos, endereço, horários (`restaurant.update`) | tudo; ganhou "Identidade visual" |
| `/dashboard/delivery` | taxa, pedido mínimo, "grátis a partir de" | sem mudança |
| API `products`, `categories`, `tenants/current/profile` | CRUD com isolamento por restaurante | mesmas rotas e regras; campos novos são opcionais |
| `menu:import` | simulação, confirmações, conflitos, relatório e `--desfazer` | tudo; ganhou a proteção das edições |

Não houve tela duplicada: o cardápio continua numa só página (agora com abas "Produtos" e
"Adicionais") e a identidade visual fica no perfil do restaurante.

## 2. Funcionalidades implementadas

### Produtos (etapa 2)
- Nome, descrição (agora também dá para apagar), categoria e ordem.
- **Preço de venda e preço "de" (promoção)**, que aparece riscado. A API recusa o preço "de" que não
  seja maior que o de venda, inclusive quando só o preço muda (`PROMOTION_PRICE_INVALID`).
- **Foto: enviar, trocar ou remover**, com **prévia antes de salvar**. O link de imagem antigo
  continua como alternativa.
- **Esgotado / disponível** (aparece, mas não pode ser pedido), **destaque**, **visível / pausado**:
  no formulário e em botões de um clique na lista.
- **Ordem**: setas para subir/descer produtos dentro da categoria e as próprias categorias.
- **Adicionais do produto**: escolher os grupos e a ordem em que o cliente os vê.
- **Duplicar** agora copia também foto, promoção e adicionais.
- Produto importado avisa no formulário que as edições ficam protegidas de uma nova importação.

### Adicionais (etapa 3) — aba "Adicionais"
- Grupos: nome, **obrigatório ou opcional**, **mínimo e máximo** de escolhas, pausar, excluir.
- Opções: nome, descrição, **preço** (0 = grátis), **máximo por produto**, **esgotado**, ativo,
  ordem, editar e remover.
- **Vincular** o grupo a produtos (lista por categoria, com busca e "marcar todos"), ou o inverso,
  pelo formulário do produto.
- Avisos: grupo obrigatório sem opção disponível (os produtos ficam esgotados no cardápio) e mínimo
  impossível de atingir. Ao editar um grupo usado em vários produtos, o painel avisa que a mudança
  vale para todos.
- **A API continua decidindo** preço e limites em todo pedido (`order-creation/option-pricing.ts`,
  sem mudança). Pedidos antigos guardam nome e preço de cada adicional (`order_item_options`): mudar
  o preço, remover a opção ou excluir o grupo não altera nada do que já foi vendido (teste E2E).

### Identidade visual (etapa 4) — "Restaurante" > "Identidade visual"
- **Logo, capa e cor principal**, com **prévia do topo do cardápio** usando o mesmo tema do cardápio
  público, antes de salvar.
- A cor aceita `#RRGGBB` ou "Usar padrão". O painel avisa quando a cor fica clara demais no fundo
  branco; o texto dos botões já escolhe branco ou escuro sozinho.
- A capa aparece também no topo do perfil, e o logo na barra lateral (atualiza na hora).
- As demais informações públicas (descrição, contatos, endereço, horários) continuam em "Editar
  perfil".
- Nada da Do'cê fica fixo no código: a demonstração `/demo` mantém seus dados fictícios, como antes.

### Proteção da importação (etapa 5)
- Cada importação aplicada guarda, na auditoria (`MENU_IMPORTED`), uma impressão digital de cada
  item e da loja como ficaram.
- Na importação seguinte, item **editado no painel** fica **MANTIDO**, com a lista do que a fonte
  mudaria; item **excluído no painel** não volta; **loja** (logo, capa, cor, dados da unidade)
  mudada fica **MANTIDA**.
- `--sobrescrever-edicoes` faz a fonte vencer de propósito. **Recuperação:** `--desfazer` devolve
  as edições e também a proteção anterior.
- Sem referência (importação feita antes desta proteção), **a gravação é recusada** e só passa com
  `--sobrescrever-edicoes`.
- Grupos criados no painel e ligados a produtos importados nunca são tocados e não contam como
  edição. Isso também corrigiu um "atualizar" falso que aparecia em toda reimportação.
- Continuam valendo: simulação por padrão, confirmação do banco e do restaurante, conflito com
  homônimos feitos à mão, relatório.

### Trava do `API_URL` (etapa 6)
- **Problema confirmado:** o endereço da API fica gravado no build do web. Compilado sem `API_URL`,
  o web apontava para `localhost:4000`, que nesta máquina é a API do ambiente
  `restaurant-saas-stack` (aconteceu na retomada de 11/11, sem gravar nada lá).
- **Travas:**
  - `next build` **falha** sem `API_URL`. Só o `next dev` mantém o padrão; `next lint` e o type
    check continuam funcionando.
  - `node server.js` **não sobe** se `API_URL` faltar ou for diferente do endereço gravado no
    build, e diz com que valor recompilar.
- **Sem efeito nos ambientes existentes:** as imagens Docker já passam o mesmo `API_URL` no build e
  na execução, e nenhum ambiente foi recompilado.

## 3. Telas e como usar

**Cardápio (`/dashboard/cardapio`), aba "Produtos"**
1. "Adicionar produto" na categoria, ou o lápis "Editar <produto>" na linha.
2. Preencha nome, categoria, preço; para promoção, o preço "de" (maior que o de venda).
3. Disponibilidade: "Visível no cardápio", "Esgotado", "Destaque".
4. Foto: "Escolher imagem" (JPEG, PNG ou WebP até 3 MB). A prévia aparece na hora; nada é enviado
   antes de "Salvar". "Remover" tira a foto.
5. "Adicionais deste produto": escolha os grupos e use as setas para a ordem.
6. Na lista: setas para a ordem; ⊘ marca/desmarca esgotado; ☆ destaque; pausa; duplicar; excluir.

**Cardápio, aba "Adicionais"**
1. "Novo grupo de adicionais": nome, "Obrigatório" (liga o mínimo), mínimo e máximo. O painel
   mostra como o cliente vai ler a regra.
2. "Novo adicional" no grupo: nome, preço (0 = grátis), máximo por produto, esgotado.
3. "Produtos (N)": marque os produtos que oferecem o grupo e salve.
4. Use ⊘ para esgotar um adicional por um tempo. "Remover" só para o que saiu de vez: os pedidos
   antigos não mudam.

**Restaurante (`/dashboard/restaurante`) > "Identidade visual"** (só proprietário e administrador)
1. Escolha logo e capa; a prévia mostra o topo do cardápio.
2. Escolha a cor (seletor ou `#RRGGBB`), ou "Usar padrão".
3. "Salvar". O cardápio público mostra a mudança em até 10 segundos.

**Reimportar com segurança (técnico, `docs/IMPORTACAO_CARDAPIO.md`)**: simular, ler os itens
MANTIDOS, aplicar; `--sobrescrever-edicoes` só se a fonte deve vencer; `--desfazer` para voltar.

## 4. Segurança e permissões (sem permissão nova)

| Papel | Produtos e categorias | Adicionais | Excluir produto/categoria/grupo | Identidade visual |
| --- | --- | --- | --- | --- |
| Proprietário, Administrador | criar e editar | criar, editar, vincular | sim | sim |
| Gerente | criar e editar | criar, editar, vincular | não | não |
| Caixa, Garçom, Visualizador | só ler | só ler | não | não |
| Cozinha, Entregador | sem acesso | sem acesso | não | não |

- **Isolamento**: todo acesso usa o restaurante do login. Grupo, opção, produto ou foto de outro
  restaurante responde 404, inclusive ao tentar vincular um grupo alheio (teste E2E).
- **Envio de imagem**:
  - um único arquivo, só em memória, cortado pelo próprio leitor acima de 3 MB (413);
  - aceito só se os bytes forem JPEG, PNG ou WebP: SVG, HTML ou texto com nome `.png` são recusados;
  - campo extra é recusado;
  - a mesma imagem é guardada uma vez por restaurante;
  - servida com `nosniff` e CSP `sandbox` (já existia).
- **Preços**: o servidor calcula tudo no pedido. Preço e total enviados pelo cliente são
  ignorados (já existia; coberto de novo).

## 5. Testes

| Teste | Resultado |
| --- | --- |
| Unitários API | **45 suítes, 448 testes** (+13: proteção da importação, regras de grupo) |
| Unitários web | **42 suítes, 444 testes** (+14: regras do painel, trava do `API_URL`) |
| E2E API completo, banco **novo** `rs_cardapio_e2e_r4` (21 migrations do zero) | **64/64 suítes, 952/952 testes** (942 anteriores, todos aprovados, + 10 novos), 508 s |
| E2E novo `menu-admin.e2e-spec.ts` | **10/10** (produtos, foto, ordem, adicionais, pedidos antigos, duplicar, identidade visual, permissões, isolamento) |
| Lint e typecheck (API e web), build de produção | limpos / OK |
| Navegador (Chrome headless), computador 1440×900 e celular 390×844 | **18/18** (17 na rodada completa + 1 conferência; ver seção 7) |
| Importação real no banco descartável | ver abaixo |

**Importação protegida, no banco `rs_cardapio` (relatórios em `execucoes/06` a `14`):**
1. Simulação sem referência: aviso. Aplicação sem `--sobrescrever-edicoes`: **recusada**.
2. Aplicação com o flag: nada mudou (78 sem mudança) e a referência foi gravada (117 impressões).
3. Depois de editar pelo painel (preço e promoção do combo, esgotado, ordem, capa e cor), a
   simulação mostrou **3 produtos MANTIDOS** e a **loja MANTIDA**, cada um com o que a fonte mudaria.
4. Aplicação protegida: as edições continuaram.
5. `--sobrescrever-edicoes`: a fonte voltou.
6. `--desfazer` desse relatório: as edições voltaram, e a simulação seguinte voltou a protegê-las.

## 6. Problemas encontrados e corrigidos neste trabalho

| # | Problema | Correção |
| --- | --- | --- |
| 1 | Web compilado sem `API_URL` falava com a API de outro ambiente | travas no build e na partida (seção 2) |
| 2 | Reimportar desfazia em silêncio as edições do painel | proteção por impressão digital (seção 2) |
| 3 | Produto com grupo criado no painel aparecia como "atualizar" em toda reimportação | links para grupos do painel ficam fora da comparação |
| 4 | Descrição do produto não podia ser apagada pelo painel | `description: null` limpa |
| 5 | Duplicar perdia foto, promoção e adicionais | duplicação feita na API, copiando tudo |
| 6 | Botões da lista com o mesmo nome ("Editar produto") em todas as linhas, para leitor de tela | cada ação diz o produto ("Editar Burger Tudo") |
| 7 | Preço aparecia como "36" e "39,9" no formulário | sempre com 2 casas ("36,00") |
| 8 | Dica de "Remover" saía 3 px do cartão e criava rolagem lateral nas tabelas de adicionais | dica nativa nesse botão |
| 9 | Limite `parts` do leitor de upload recusava até o envio válido | limites só de arquivo (1), campos (0) e tamanho (3 MB) |

## 7. Capturas

Em `capturas/administracao-2026-11-11/` (fora do Git):
- `01`–`05`: produtos no computador, edição, erro da promoção, prévia da foto, lista depois;
- `06`–`09`: adicionais, vincular produtos, aviso de grupo obrigatório, adicionais depois;
- `10`–`12`: identidade visual (cor clara avisada, prévia, perfil com capa);
- `13`–`14`: cardápio público com as mudanças e o grupo novo no produto;
- `15`–`19`: celular (produtos, formulário, adicionais, identidade visual, cardápio).

Na rodada completa, uma verificação falhou por erro do próprio script, que procurava "R$ 39,90"
com espaço comum, mas o valor usa espaço não separável. A captura `05` e a conferência
`admin-recheck` confirmaram o valor certo na lista. Depois das capturas, as correções 7 e 8 da
seção 6 foram feitas e a tabela foi medida de novo (sem rolagem lateral).

## 8. Pendências

1. **PDV e comandas** continuam vendendo pelo preço base, sem adicionais (P3 do plano).
2. **Relatório de vendas por adicional** (P3).
3. Imagens trocadas ficam guardadas no banco (uma por conteúdo), para que um relatório de
   importação ainda possa restaurá-las. Falta uma limpeza das imagens que nada mais usa.
4. Selos ("Novo", "Vegetariano") vindos da importação são mostrados no cardápio público, mas não
   têm campo no painel (não foram pedidos).
5. Cada adicional pode ter foto no banco (importada), mas o painel não envia foto de adicional.
6. A primeira reimportação num ambiente real que já tenha recebido importação antiga precisa de
   `--sobrescrever-edicoes` uma vez, para gravar a referência. Faça antes de alguém editar pelo
   painel, ou confira a simulação item a item.
7. Integração: a migration 21 e estas telas existem só nesta branch. Merge, migração do DEV e
   deploy dependem da sua revisão.

## 9. Ambiente de teste

- Web `http://127.0.0.1:3700` (painel em `/dashboard/cardapio`, cardápio em `/menu/doce-importacao`)
  e API `http://127.0.0.1:4700`, banco `rs_cardapio`. Contas de teste:
  `dono@importacao-teste.example` e `dona@outro-teste.example`, com senha aleatória da sessão.
- Ao final, o cardápio de teste foi devolvido à fonte com uma importação `--sobrescrever-edicoes`
  (relatório guardado), e os grupos criados no teste foram excluídos.
