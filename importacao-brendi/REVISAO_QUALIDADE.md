# Revisão final de qualidade — cardápio novo (10/11/2026)

Feita na worktree `restaurant-saas-cardapio`, branch `cardapio-brendi`, sobre o commit `f417823`,
só com bancos descartáveis (container `rs-cardapio-pg`). Não houve nova extração da Brendi, nem
merge, push ou deploy. DEV, homologação, piloto, demo e o ambiente final acadêmico não foram
tocados.

## 1. Testes

| Teste | Resultado |
| --- | --- |
| E2E API completo, banco **novo e vazio** com as 21 migrations aplicadas do zero (`rs_cardapio_e2e_r2`) | **942/942**, 63/63 suítes (941 anteriores + 1 novo do logo no `/auth/me`) |
| E2E API completo final, com todo o código desta revisão, outro banco novo (`rs_cardapio_e2e_r3`) | **63/63 suítes, sem falha.** A rodada de 10/11 parou na 53ª suíte (todas aprovadas) quando a sessão foi encerrada; em 11/11 rodaram só as 10 que faltavam, no mesmo banco e com o mesmo código: **10/10 suítes, 43/43 testes** (ver seção 8) |
| Unitários API | **44 suítes, 435 testes** (+1: campos da loja que mudam) |
| Unitários web | **40 suítes, 430 testes** (+8: marca do painel e cache curto do cardápio) |
| Lint e typecheck (API e web), build de produção | limpos / OK |

## 2. Conferência da importação (banco descartável `rs_cardapio`)

| Item | Resultado |
| --- | --- |
| Fidelidade (`ferramentas/conferir-fidelidade.mjs`, ampliado) | **801/801** com o texto da página da Brendi (723/723 sem ele) |
| Produtos | 78 (9 esgotados), sem duplicata por `externalId` nem por nome |
| Categorias e ordem | 9 categorias na ordem da loja; produtos na ordem de cada categoria (verificações novas) |
| Preços e promoções | preço, preço "de" e o rótulo exibido na Brendi ("A partir de", "De … por …") dos 78 |
| Adicionais | 2 grupos, 27 opções no banco (26 ativas, 1 esgotada); 25 oferecidas no cardápio, como na Brendi |
| Mínimos e máximos | "Turbine seu lanche!" 0–10, "Refrigerante combo" 1–5; máximo por opção conferido em cada uma |
| Imagens | 77 imagens distintas no banco; 75 produtos com foto, 3 sem (como na Brendi); logo e capa |
| Entrega | taxa R$ 3,00, mínimo R$ 21,00, **grátis a partir de R$ 23,00** |
| Duplicidade | nova simulação do importador: "sem mudança" em 9 categorias, 2 grupos, 27 adicionais, 78 produtos e na loja |
| Multi-tenant | `outro-restaurante`: 0 produtos, 0 imagens, 0 grupos, cardápio vazio |

**Cálculo no servidor, no ambiente de teste ao vivo** (`server-pricing`, 9/9):
- base + adicionais × quantidade (2× Burger Tudo + 2 Bacon + Ovo = R$ 88,00), com nomes e preços
  congelados no pedido;
- preço e total enviados pelo cliente são **descartados** (o endpoint público ignora campos
  extras, por projeto) e o valor cobrado é o do servidor;
- adicional de outro produto, grupo obrigatório sem escolha e mais de 10 adicionais são
  recusados;
- frete de R$ 3,00 abaixo de R$ 23,00 em itens, grátis a partir daí;
- pedido mínimo de entrega recusado abaixo de R$ 21,00;
- cupom de 10%: a prévia e o pedido descontam sobre itens + adicionais (R$ 88,00 − 8,80).

## 3. Identidade visual do painel (multi-tenant)

**Antes:** a barra lateral de **todos** os restaurantes, e também a da Administração da
Plataforma, mostrava o logo da Do'cê, que estava fixo no código. O perfil do restaurante também.

**Agora:**
- `/auth/me` devolve `tenant.logoUrl`, o logo do próprio restaurante, ou `null`. É só um campo de
  exibição: regras de login, sessão e permissões não mudaram;
- a barra lateral e o perfil mostram o logo do restaurante ou, sem logo, as iniciais do nome
  ("OR" para "Outro Restaurante"); recolhida, a barra lateral leva o nome do restaurante;
- a demonstração (`/demo`) continua com o logo fictício da Do'cê.

Testado com dois restaurantes no navegador (8/8, computador e celular), num teste de
renderização (5 casos) e num E2E da API (cada restaurante recebe só o próprio logo).
Capturas em `capturas/revisao-2026-11-10/marca/`.

Para a Do'cê real, o logo passa a vir do banco: depois de integrar, a importação com
`--incluir-loja` grava o logo. Até lá o painel mostra as iniciais "DH".

## 4. Problemas encontrados e corrigidos

| # | Problema | Correção |
| --- | --- | --- |
| 1 | **Consumo da API:** os links de produto pré-carregavam a página de cada produto ao aparecerem na tela, e cada página pedia o cardápio inteiro à API. Uma pessoa rolando o cardápio gerava dezenas de chamadas em segundos, todas saindo do IP do servidor web, que **divide um único limite de 100/min entre todos os clientes**. Na revisão, isso derrubou o próprio teste com erro 429 | pré-carga desligada nos links de produto e cardápio guardado por 10 s no servidor web, por restaurante (só respostas de sucesso, no máximo 200 restaurantes). Uma visita inteira com 5 idas ao carrinho passou a gastar **2** chamadas. Preço, estoque e horário continuam conferidos pela API no pedido |
| 2 | Campos do checkout identificados só pelo placeholder, que some ao digitar | nome acessível em todos os campos e preenchimento automático de endereço |
| 3 | "Complemento (opcio…" cortado no celular | placeholder "Complemento" (o nome acessível diz "opcional") |
| 4 | Valores quebrando em duas linhas ("R$" / "44,00") no resumo do checkout, no carrinho, no acompanhamento e em "grátis acima de R$ 23,00" | valores sempre numa linha |
| 5 | Dois botões de limpar na busca (o do navegador e o nosso) | só o nosso |
| 6 | Grupo obrigatório: só uma borda vermelha, sem explicar | mensagem "Escolha 1 opção para continuar." anunciada a leitores de tela |
| 7 | Busca de opção sem resultado deixava a lista vazia | "Nenhuma opção encontrada." |
| 8 | Produto esgotado mostrava o campo de observação | campo escondido quando não dá para adicionar |
| 9 | Produto inexistente mostrava "Restaurante não encontrado" | página própria "Produto não encontrado", com link para o cardápio do restaurante |
| 10 | Acompanhamento de pedido com entrega grátis não mostrava a taxa | linha "Taxa de entrega: Grátis" |
| 11 | Link do produto lido como só o nome (sem preço) por leitores de tela | o link lê nome, descrição, preço e "Esgotado" |
| 12 | Alvos de toque menores que 32 px no celular (Limpar, lixeira, "Adicionar mais itens", voltar) | área de toque maior, mesmo visual |
| 13 | A simulação do importador listava todos os campos da loja mesmo sem mudança | lista só o que muda ("loja: sem mudança") |

A auditoria automática de acessibilidade (idioma, um `h1`, `alt` nas imagens, nome em botões,
links e campos, alvos de toque no celular, rolagem horizontal, imagens quebradas) ficou limpa no
computador e no celular, em 10 telas. O teste de pedido completo no navegador continua
**17/17**.

Nada foi inventado da Brendi: as mudanças são de legibilidade, acessibilidade e estados de erro.

## 5. Compatibilidade dos pedidos

- **Pedidos online:** com e sem adicionais, com observação, cupom, entrega e retirada (E2E,
  navegador e verificação ao vivo).
- **Pedidos antigos:** sem adicionais, continuam iguais; `order_item_options` é uma tabela nova e
  opcional.
- **Painel, cozinha e acompanhamento:** mostram os adicionais e a observação.
- **PDV e comandas:** vendem pelo preço base, sem adicionais (pendência conhecida, P3 do plano).
- **Repetição de pedido** com a mesma chave de idempotência: devolve o mesmo pedido; com
  adicionais diferentes, é recusada.

## 6. Capturas

Em `capturas/revisao-2026-11-10/` (fora do Git):
- `antes/`: o cardápio no início da revisão, só celular. A pausa causada pelo limite 429
  impediu a rodada no computador;
- `depois/`: celular e computador, com cardápio, busca vazia, produto de nome longo, de descrição
  longa e esgotado, grupo obrigatório sem escolha, adicionais, observação, carrinho, checkout,
  cupom inválido, acompanhamento, pedido mínimo, carrinho vazio, produto e restaurante
  inexistentes. Também `montagem-estados.png`;
- `marca/`: o painel e o perfil dos dois restaurantes, lado a lado.

## 7. Pendências administrativas

Ver `PLANO_ADMINISTRACAO.md`: telas existentes, o que falta, esforço e riscos, sem implementação.

## 8. Retomada em 11/11/2026

**Por que parou.** A rodada E2E final (`rs_cardapio_e2e_r3`) rodava em segundo plano quando a
sessão de 10/11 terminou, e o processo foi encerrado junto. Depois o computador foi reiniciado
(11/11, 13:34) e o Docker parou: containers, API (4700) e web (3700) estavam fora do ar. As 53
suítes que rodaram tinham passado.

**O que foi retomado, só o necessário:**
- nenhum arquivo da API mudou depois do início da r3 (último às 19:57, r3 às 20:17), então
  rodaram só as **10 suítes que faltavam**, no mesmo banco: **10/10, 43 testes**. Com as 53
  anteriores, a r3 fecha **63/63 suítes**. Não houve rodada completa nova;
- unitários de novo: API **44 suítes / 435 testes**, web **40 suítes / 430 testes**; lint e
  typecheck limpos;
- `app/demo/restaurante/page.tsx` estava fora do padrão do Prettier: formatado, sem mudança de
  comportamento;
- importação no banco `rs_cardapio`: 78 produtos (9 esgotados), 9 categorias, 2 grupos, 27
  adicionais, 75 produtos com foto, 77 imagens; fidelidade **723/723**;
- navegador, celular (390×844) e computador (1440×900): revisão do cardápio **6/6** com
  acessibilidade limpa nas 20 telas; marca por restaurante **8/8**. Para os testes de compra, a
  loja foi aberta 24 h só no banco descartável e os horários reais foram restaurados no fim
  (`openNow=false` numa quarta-feira, como deve ser).

**Problema de ambiente encontrado (não é defeito do código).** O web foi recompilado sem
`API_URL`, e o Next grava o destino do proxy `/api` **na compilação**. Por isso o proxy apontou
para o padrão `localhost:4000`, que nesta máquina é a API do ambiente `restaurant-saas-stack`, e
as fotos e o pedido de teste voltaram 404. Foi conferido, só com leitura, que nada foi gravado lá
(nenhum pedido nas últimas 2 h, nenhum restaurante `doce-importacao`). A web foi recompilada com
`API_URL=http://127.0.0.1:4700/v1`, e a revisão passou. **Regra para quem compilar:** `API_URL`
precisa estar definido no `next build`, não só no `node server.js`. Na Vercel isso já é
obrigatório (`next.config.js`); em compilação local, não.

Capturas desta retomada em `capturas/revisao-2026-11-11/` (fora do Git).
