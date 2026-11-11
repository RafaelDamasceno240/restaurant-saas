# IMPORTAÇÃO BRENDI + NOVO CARDÁPIO SAAS

Data: 10/11/2026 · Branch local `cardapio-brendi` (worktree `restaurant-saas-cardapio`, a partir de
`16bd3b0`) · Nada enviado (sem push, sem deploy) · Testado só em ambiente descartável.

A versão acadêmica (`restaurant-saas-final`), o PowerPoint, DEV, demo, piloto e homologação **não
foram alterados**. O cardápio antigo do ambiente final foi apenas visualizado (GET) para a captura
"ANTES".

## 1. Categorias extraídas

**11** categorias. **9** com produtos publicados (importadas, na ordem da loja). As outras 2
("Promoção", "Lançamento") só listam produtos que a loja não publica, por isso não são importadas.

## 2. Produtos extraídos

**78** produtos publicados: 69 disponíveis e 9 esgotados (seção "Em falta").
- **33** produtos aparecem listados nas categorias, mas a loja não os publica. A página não traz
  nenhum dado deles, então ficaram só como contagem: nada foi inventado.
- **2** preços promocionais ("De R$ 35,00 por R$ 32,00").
- **27** produtos são exibidos com "A partir de".
- **6** selos: 1 Vegetariano e 5 Novidade.
- **5** produtos aparecem em "Mais Pedidos".

## 3. Adicionais

**2** grupos e **27** opções:
- "Turbine seu lanche!": 0 a 10 unidades, 23 opções (1 esgotada, 1 inativa), usado em 29 produtos.
- "Refrigerante combo": obrigatório, de 1 a 5 unidades, 4 opções sem custo, usado em 1 produto.

São 23 opções pagas e 4 sem custo, e cada opção tem o seu máximo próprio. Os dados estão em
`dados/adicionais.csv` e `dados/produto-adicionais.csv`.

## 4. Fotos

**80** fotos originais baixadas, sem nenhum erro (cerca de 15 MB):
- 75 de produtos, 1 de opção, o logo, a capa e 1 banner promocional;
- 3 produtos não têm foto na loja;
- cada foto tem o SHA-256 registrado em `dados/imagens.csv`.

Na importação entram **77 imagens distintas** (o banner não é importado). Elas ficam guardadas no
próprio banco e são servidas pelo SaaS, sem depender da Brendi.

## 5. Incompatibilidades encontradas

O detalhe está em `COMPARACAO.md`. Resumo:
- **Não observado:** carrinho e checkout da Brendi. A loja estava fechada durante a análise (abre de
  quinta a domingo, às 19:00) e a página bloqueia "adicionar" fora do horário.
- **O SaaS não tinha** (implementado nesta etapa): adicionais, observação por item, preço
  promocional, esgotado, selos, destaques, logo, capa e cor da marca, fotos próprias e entrega
  grátis a partir de um valor.
- **Diferenças que ficam:**
  - taxa de entrega por distância: as duas faixas da Do'cê custam R$ 3,00, então o valor é igual,
    mas o limite de 10 km não é verificado;
  - "Mais Pedidos" é calculado por vendas na Brendi; no SaaS são destaques marcados pelo restaurante;
  - pagamento online não existe no SaaS (fora do escopo; só registra a preferência);
  - não há login do cliente no cardápio.
- **Pendente:** tempo estimado, agendamento, pausas programadas, banner promocional, "serve 1
  pessoa", adicionais no PDV e nas comandas, e edição de adicionais pela tela do painel.

## 6. Funcionalidades implementadas

**Migration 21 `20261110210000_menu_options_and_media`.** É só aditiva; o banco garante as regras com
CHECKs.
- Tabelas novas `option_groups`, `option_items`, `product_option_groups`, `order_item_options` e
  `media_assets`.
- Produto: `compareAtPriceCents`, `soldOut`, `featured`, `badges`, `imageMediaId` e `externalId`.
- `order_items.notes`, `categories.externalId`, `tenants.logoMediaId`, `coverMediaId` e
  `brandColor`, e `branches.deliveryFreeAboveCents`.

**API**
- O servidor calcula o preço dos adicionais (`option-pricing.ts`). São recusados: grupo obrigatório
  sem escolha, opção esgotada, inativa, de outro produto ou de outro restaurante, acima do máximo da
  opção ou do grupo, e produto esgotado.
- O pedido grava um snapshot de nomes e preços dos adicionais. O preço unitário da linha já inclui
  os adicionais, então caixa, cupom, relatórios e totais não mudaram de fórmula.
- O reenvio idempotente compara também os adicionais e a observação.
- Os adicionais e a observação aparecem no pedido público, no painel e na cozinha (KDS).
- Endpoint `GET /public/media/:id`:
  - o formato é validado pelos bytes, com limite de 3 MB;
  - cache de 1 ano, ETag e resposta 304;
  - `nosniff` e CSP restrita;
  - limite próprio de 1000 requisições por minuto (o limite global de 100 quebrava as fotos);
  - imagem de restaurante suspenso responde 404.
- O cardápio público passou a mostrar grupos, opções, promoção, esgotado, destaques, selos, logo,
  capa, cor da marca, fuso horário e "entrega grátis a partir de".
- Entrega grátis a partir de um valor dos itens: tela de configuração de entrega e checkout.

**Importador** (`pnpm menu:import`, documentado em `docs/IMPORTACAO_CARDAPIO.md`)
- Simula por padrão. Gravar exige confirmar o banco (conferido também no servidor) e o restaurante.
- Valida o arquivo antes de gravar, e tudo roda em uma única transação.
- É idempotente pelo `externalId`.
- Item criado à mão com o mesmo nome vira CONFLITO e bloqueia a gravação; só `--adotar-por-nome`
  permite atualizá-lo.
- Imagens: deduplicadas por hash, conferidas, e a ausente vira aviso.
- `--incluir-loja` importa logo, capa, horários, WhatsApp, endereço, taxa, grátis a partir de e
  pedido mínimo.
- Gera relatório JSON, registra no log de auditoria e permite `--desfazer`.

**Cardápio público (novo design)**
- Tema claro tingido pela cor de cada restaurante. Nada da Do'cê ficou fixo no código, e nenhum
  código ou marca da Brendi foi copiado.
- Capa e cartão da loja: aberto ou fechado com o horário de abertura ("abre quinta às 19:00", no
  fuso do restaurante), taxa, mínimo e retirada.
- Destaques, busca sem acentos e abas de categorias que acompanham a rolagem.
- Lista com foto à direita, "A partir de" e "De … por …", selos e seção "Em falta".
- Página do produto com endereço próprio:
  - grupos com contador, aviso "Obrigatório" e filtro de opções;
  - observação de até 140 caracteres e quantidade;
  - bloqueio quando a loja está fechada.
- Informações da loja numa folha própria (horários, como pedir, pagamento, endereço e WhatsApp).
- Carrinho com uma linha por combinação de adicionais e observação; checkout envia só ids e
  quantidades.

## 7. Resultado dos testes

| Teste | Resultado |
| --- | --- |
| Unitários API | **44 suítes, 434 testes OK** (antes: 41/410) |
| Unitários web | **38 suítes, 422 testes OK** (antes: 37/401) |
| E2E API completo (banco descartável) | **940/941** na 2ª rodada completa. A falha foi uma comparação exata do formato da resposta de entrega (campo novo `freeAboveCents`); o teste foi atualizado e passa (onboarding + entrega: 6 suítes, 95/95) |
| E2E novo `menu-options` | adicionais, preço no servidor, snapshots, isolamento, idempotência, cupom, PDV, imagens (304, limite próprio), CHECKs do banco |
| Lint e typecheck (API e web) | limpos |
| Build de produção (API e web) | OK |
| Importador em banco descartável | simulação → aplicação (78 produtos, 27 adicionais, 77 imagens) → reexecução "sem mudança" em tudo → desfazer (zerou e restaurou a loja) → reaplicação |
| Fidelidade (`ferramentas/conferir-fidelidade.mjs`) | **782/782**: preço, "de", esgotado, categoria, descrição, foto, destaque e adicionais dos 78 produtos, o preço exibido na lista da Brendi, as regras dos grupos e a contagem |
| Navegador real (celular 390×844 e computador 1920×1080) | **17/17** verificações (detalhe abaixo) |
| Isolamento | o 2º restaurante continua vazio; adicional de outro restaurante é recusado; vínculo forjado entre restaurantes é ignorado |

O que o teste no navegador cobriu:
- cardápio, abas, busca, informações da loja, ausência de rolagem horizontal e imagens servidas
  pelo próprio host;
- Burger Tudo com 2 Bacon, 1 Ovo, observação e quantidade 2: R$ 88,00;
- combo com grupo obrigatório: o botão bloqueia até a escolha;
- carrinho com R$ 134,99;
- checkout de entrega com taxa grátis (os itens passam de R$ 23,00);
- pedido criado e acompanhamento com os adicionais;
- painel e cozinha mostrando os adicionais e a observação.

## 8. Capturas de comparação visual

Ficam em `importacao-brendi/capturas/` (fora do Git, só nesta máquina):

| Arquivo | Conteúdo |
| --- | --- |
| `comparacao-inicio-celular.png` | Brendi × SaaS antes × SaaS depois (celular) |
| `comparacao-inicio-computador.png` | Brendi × SaaS antes × SaaS depois (computador) |
| `comparacao-produto-celular.png` | Página do produto e adicionais, Brendi × SaaS |
| `comparacao-obrigatorio-celular.png` | Grupo obrigatório e informações da loja, Brendi × SaaS |
| `fluxo-pedido-saas-celular.png` | Carrinho, checkout e pedido recebido |
| `equipe-pedido-e-cozinha.png` | Painel do pedido e cozinha (KDS) com adicionais |
| `individuais/` | Todas as capturas soltas (`brendi-*` e `saas-*`) |

## 9. Pendências

1. **Carrinho e checkout da Brendi não observados** (loja fechada). Para conferir, abrir a página
   entre quinta e domingo, das 19:00 às 23:00, sem finalizar pedido.
2. **Tela do painel para editar adicionais, logo, capa, cor, destaques, selos, promoção e
   esgotado.** Hoje só o importador grava esses dados; a tela de entrega já edita "grátis a partir
   de". Análise, esforço e riscos em `PLANO_ADMINISTRACAO.md`.
3. **Adicionais no PDV e nas comandas.** Nesses canais o produto é vendido pelo preço base e o
   grupo obrigatório não é exigido.
4. **Recursos da Brendi ainda não suportados:** tempo estimado, agendamento, pausas programadas,
   taxa por distância (com raio), banner promocional, porção ("serve 1 pessoa") e pagamento online
   (fora do escopo).
5. **Fotos grandes:** 2 produtos têm mais de 1 MB e são servidos como estão. Falta gerar versões
   otimizadas.
6. **Nome do restaurante:** a importação não altera o nome. No teste foi provisionado como "Do'cê
   Hamburgueria e Confeitaria".
7. **Cor da marca usada no teste (#1C1917, o preto do logo):** foi escolhida por mim a partir do
   logo; a Brendi não informa uma cor. Confirmar com o proprietário.
8. **Direitos de uso:** as fotos e os textos são do restaurante. Confirmar com o proprietário antes
   de publicar.
9. ~~A barra lateral do painel tinha o logo e o nome da Do'cê fixos no código.~~ **Resolvido na
   revisão de 10/11** (ver `REVISAO_QUALIDADE.md`): cada restaurante vê o próprio logo, ou as
   iniciais quando não tem.
10. **Relatório de vendas:** o valor dos adicionais entra no preço da linha; não existe relatório
    por adicional.

## 10. Plano seguro para integrar ao SaaS principal

1. **Revisar o diff da branch `cardapio-brendi`** (commit local). Os pontos que mais pedem atenção
   são a migration, `order-creation.service.ts` e o checkout.
2. **Juntar à `salto-desenvolvimento`** com merge local; não há conflito esperado, porque partiu do
   HEAD atual dela. Rodar unitários, E2E completo em banco descartável e build.
3. **Aplicar a migration 21 em homologação primeiro**, com backup antes. A migration é aditiva: não
   altera nenhuma linha existente, e os CHECKs valem para todas.
4. **Importar o cardápio em homologação:** simulação, depois `--aplicar` com as duas confirmações e
   guarda do relatório. Rodar `conferir-fidelidade.mjs` e um pedido de teste em cada canal.
5. **Antes de importar no restaurante real:**
   - decidir a cor da marca e obter a autorização das fotos com o proprietário;
   - fazer backup do banco;
   - a simulação precisa mostrar **0 conflitos**: se a Do'cê já tiver produtos cadastrados à mão,
     decidir entre `--adotar-por-nome` e renomear.
6. **Push para a `master` só com autorização explícita,** porque dispara deploy de produção
   (Vercel/Railway). A migration roda pelo job de migrate do deploy.
7. **Recuperação:** se algo der errado depois de importar, usar `--desfazer` com o relatório da
   aplicação; ou restaurar o backup feito no passo 5.

## Ambiente de teste deixado no ar (descartável)

- **Containers:** `rs-cardapio-pg` (127.0.0.1:55442, bancos `rs_cardapio`, `rs_cardapio_e2e`,
  `rs_cardapio_e2e_r2` e `rs_cardapio_e2e_r3`, os dois últimos criados vazios na revisão para as
  rodadas E2E finais) e `rs-cardapio-redis` (127.0.0.1:56389), com o label
  `projeto=cardapio-brendi-descartavel`.
- **Serviços:** API em http://127.0.0.1:4700 e web em http://127.0.0.1:3700/menu/doce-importacao,
  ambos com builds de produção.
- **Restaurantes de teste:** `doce-importacao` (dono: dono@importacao-teste.example) e
  `outro-restaurante` (dona: dona@outro-teste.example). Na revisão, as duas contas de teste
  ganharam uma senha nova aleatória, guardada só num arquivo temporário da sessão; o ambiente não
  tem nenhuma conta real.
- **Pedidos de teste:** o banco `rs_cardapio` tem os pedidos criados pelo teste no navegador.
- **Horários:** voltaram aos importados (quinta a domingo, a partir das 19:00), então o cardápio
  aparece como fechado fora desse horário.
