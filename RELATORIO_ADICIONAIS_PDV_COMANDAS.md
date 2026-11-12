# Relatório — Adicionais no PDV e nas comandas

Data: 12/11/2026
Branch: `adicionais-pdv-comandas` (worktree `restaurant-saas-adicionais`, criada a partir de
`salto-desenvolvimento` em `c866ff5`). Commit apenas local: **sem push, sem deploy, sem
integração à `salto-desenvolvimento`**.

## 1. Resumo

O atendente agora escolhe adicionais no PDV e nas comandas de mesa, com as mesmas regras do
cardápio público: grupos obrigatórios, mínimo e máximo por grupo, quantidade máxima por adicional,
bloqueio de adicional esgotado e observação por item. O preço continua sendo decidido só pela API:
a tela mostra uma estimativa imediata no modal e, no carrinho e no rascunho da rodada, os valores
que a própria API calcula (endpoints de cotação). A venda, a rodada e o fechamento da conta
recalculam tudo de novo no servidor.

Antes desta etapa, o PDV e as comandas vendiam o produto pelo preço base e ignoravam os grupos
obrigatórios (pendência P3 registrada em `INTEGRACAO_CARDAPIO_BRENDI.md`).

## 2. Arquitetura (o que foi reaproveitado)

| Regra | Onde já existia | Como foi usada |
|---|---|---|
| Preço e validação dos adicionais | `order-creation/option-pricing.ts` (`priceOptions`) | Sem mudança de lógica; agora vale para todos os canais |
| Leitura de produto + grupos, isolamento por tenant, produto esgotado | `OrderCreationService.priceItems` | Reutilizado pelo PDV, pela cotação e **pelas rodadas da comanda** (antes a rodada tinha a própria leitura de produtos) |
| Snapshot dos adicionais na venda | `order_item_options` (migration 21) | Sem mudança; o fechamento da comanda agora copia os adicionais e a observação de cada item |
| Regras de escolha no front (radio, limites, obrigatórios) | `web/lib/menu-display.ts` (cardápio público) | Reutilizado pelo modal do PDV/comanda via `lib/staff-addons.ts` |
| Identidade de linha (produto + adicionais + observação) | `web/lib/cart-logic.ts` (`lineKey`) | Reutilizado no carrinho do PDV e no rascunho da rodada |

Nenhuma regra de negócio foi duplicada: há um único cálculo de preço de adicional (API) e uma única
regra de escolha (front, só para exibição).

## 3. Migration

**22ª migration: `20261112120000_tab_item_options`** — somente aditiva:

- nova tabela `tab_item_options` (snapshot do adicional de UMA unidade do item da comanda:
  `groupNameSnapshot`, `optionNameSnapshot`, `unitPriceCents`, `quantity`, `optionItemId` com
  `ON DELETE SET NULL`), FK para `tab_items` com `ON DELETE CASCADE`;
- CHECKs iguais aos de `order_item_options` (preço ≥ 0, quantidade ≥ 1);
- nenhum dado existente muda: todo item de comanda já lançado mantém preço e fica sem adicionais.

Convenção mantida: `tab_items.unitPriceCentsSnapshot` = preço do produto + soma dos adicionais da
unidade (a mesma de `order_items.unitPriceCents`).

Validada **apenas em bancos descartáveis** (`rs_adic` e `rs_adic_e2e`, container `rs-adic-pg`,
porta 55480): `prisma migrate deploy` 21 → 22 e `prisma migrate diff` banco × schema = **sem
diferença**. **Não foi aplicada no DEV.**

## 4. Arquivos e módulos modificados

### API (`apps/api`)
- `prisma/schema.prisma`, `prisma/migrations/20261112120000_tab_item_options/` — modelo `TabItemOption`.
- `order-creation/dto/order-line.dto.ts` (novo) — `OrderLineOptionDto`, `StaffOrderLineDto`, `QuoteItemsDto`.
- `order-creation/order-creation.service.ts` — grupos obrigatórios exigidos em todos os canais;
  `priceItems` com `skipUnitLimit`/`unavailableMessage`; novo `quoteItems` (cotação somente-leitura).
- `order-creation/option-pricing.ts` — comentário da regra; `PricedOption.optionItemId` aceita `null`
  (adicional excluído do cardápio depois de lançado na comanda).
- `pos/` — `PosOrderItemDto` com `options`/`notes`; **`POST /v1/pos/orders/quote`** (`pos.create`).
- `coupons/dto/coupons.dto.ts` — a prévia de cupom do PDV aceita adicionais (preço igual ao da venda).
- `public-orders/dto/create-order.dto.ts` — usa o DTO de adicional compartilhado (sem mudança de contrato).
- `tabs/` — rodada com `options`; **`POST /v1/tabs/:id/rounds/quote`** (`tabs.update`); rodada passa
  a usar `priceItems`; snapshot em `tab_item_options`; idempotência compara também os adicionais;
  detalhe da comanda devolve `options`, `basePriceCents`, `extrasCents`; fechamento copia adicionais
  e observação para a venda.
- `orders/orders.service.ts` + DTO — quadro da cozinha devolve os adicionais de cada item das rodadas.

### Web (`apps/web`)
- `components/sales/ProductOptionsDialog.tsx` (novo) — modal de personalização compartilhado.
- `lib/staff-addons.ts` (novo), `lib/use-server-quote.ts` (novo) — adaptação dos grupos, linha
  para a API, cotação do servidor com debounce.
- `app/dashboard/pdv/page.tsx`, `lib/pos-logic.ts`, `lib/pos-api.ts`, `lib/coupons-logic.ts` — PDV.
- `app/dashboard/mesas/[tableId]/page.tsx`, `lib/tab-round-logic.ts`, `lib/tabs-api.ts` — comanda.
- `components/kds/KdsTableRoundCard.tsx`, `lib/orders-api.ts` — cozinha.

### Testes
- API: `order-creation.quote.spec.ts` (novo), `tab-calculations.spec.ts`, `tab-checkout.spec.ts`,
  `test/addons-pos-tabs.e2e-spec.ts` (novo, 20 cenários), `test/menu-options.e2e-spec.ts`
  (o teste "PDV vende pelo preço base" foi trocado por "PDV exige o grupo obrigatório").
- Web: `staff-addons.test.ts` (novo), `pos-logic.test.ts`, `tab-round-logic.test.ts`.

Não foram alterados: `app/demo/*`, seed/permissões, importador Brendi, cardápio público.

## 5. Regras de negócio implementadas

- **Multi-tenant:** produto e adicional sempre lidos com o `tenantId` do token; adicional de outro
  restaurante ou de outro produto = `OPTION_UNAVAILABLE` (sem revelar qual); comanda de outro
  restaurante = 404.
- **RBAC existente, sem permissão nova:** PDV e cotação do PDV = `pos.create`; rodada e cotação da
  rodada = `tabs.update`; leitura dos grupos = `products.read` (já existente para CAIXA e GARÇOM).
- **Grupo obrigatório, mínimo e máximo, limite por adicional:** `OPTION_REQUIRED` / `OPTION_LIMIT`.
- **Esgotados:** adicional esgotado ou grupo inativo = `OPTION_UNAVAILABLE`; produto esgotado
  recusado no PDV (já era) **e agora também na rodada da comanda** (antes a rodada aceitava).
- **Centavos e preço no servidor:** os DTOs não têm campo de preço/nome; um campo extra é recusado
  com 400 (testado). O front envia só ids, quantidades e observação.
- **Snapshot e histórico:** nome do grupo, nome e preço do adicional congelados na venda e no item da
  comanda; mudar preço, renomear ou excluir o adicional não altera vendas nem itens já lançados
  (testado em PDV e em comanda com duas rodadas).
- **Cupom, cashback, fiado, taxas:** a fórmula do total não mudou; os adicionais entram no subtotal
  do item (portanto no desconto percentual do cupom, no limite do cashback e no valor do fiado).
- **Comanda:** rodadas novas preservam as anteriores; cancelamento de unidades tira do total o valor
  da unidade com os adicionais; fechamento cobra exatamente o total da comanda; comanda fechada
  recusa novas rodadas (`TAB_CLOSED`). Reabertura de comanda **não existe** nas regras atuais
  (comanda fechada é somente leitura) e continua assim.

## 6. Impacto em estoque e caixa

- **Estoque:** os adicionais **não consomem estoque**. No modelo atual só o produto tem ficha
  técnica (`product_recipes`); grupos/opções não têm receita, e esta etapa não criou uma. O produto
  continua baixando a própria ficha como antes (PDV na confirmação, comanda no envio da rodada).
  Se o restaurante quiser que "bacon extra" baixe bacon do estoque, é uma funcionalidade nova
  (ficha técnica por adicional) — listada nas pendências.
- **Caixa:** a venda em dinheiro grava o movimento `SALE` com o total da venda, adicionais
  incluídos (testado: venda de R$ 78,00 → `SALE` 7800, saldo esperado do caixa correto); o
  fechamento da comanda em dinheiro idem (R$ 86,50 testado). Nenhuma mudança na lógica do caixa.
- **Relatórios:** o relatório de produtos soma a receita da linha com os adicionais dentro do preço
  unitário (testado: R$ 78,00). Não há relatório "por adicional" (pendência).

## 7. Experiência de uso

- Modal de personalização (Dialog do design system, tamanho grande): grupos em cartões, selo
  **OBRIGATÓRIO** em destaque (verde com ✓ quando atendido), contador `n/máx`, radio para escolha
  única e passos `− n +` para múltipla, adicional esgotado riscado e desabilitado, observação para
  a cozinha com contador, quantidade e preço atualizados a cada toque.
- Validação: confirmar sem o obrigatório destaca o grupo em vermelho, rola até ele, foca a primeira
  opção e mostra "Escolha uma opção em "Ponto da carne"". Grupo obrigatório sem nenhuma opção
  disponível bloqueia o produto com explicação.
- Carrinho do PDV: cada linha mostra adicionais, observação, preço unitário e "base + adicionais";
  botões Editar (abre o modal com as escolhas da linha) e Remover por linha; rodapé indica
  "Valores conferidos pelo sistema" quando o total é o da API.
- Comanda: o mesmo modal ("Adicionar à rodada"), rascunho com adicionais e botão Editar, valor do
  rascunho conferido pela API, itens enviados com adicionais e "base + adic.".
- Teclado: Tab percorre os controles, Esc fecha, Ctrl+Enter confirma; F9 e "/" do PDV ficam
  desativados com o modal aberto. Alvos de toque de 44 px em tablet (`touch:`).
- Produto sem adicionais continua com o fluxo rápido (toque = +1); a observação pode ser adicionada
  depois pelo botão Editar.

## 8. Testes executados (todos em bancos descartáveis)

| Suíte | Resultado |
|---|---|
| API unitários (`jest`) | **46 suítes / 461 testes — todos passaram** (antes: 448) |
| Web unitários (`jest`) | **43 suítes / 461 testes — todos passaram** (antes: 444) |
| Lint + typecheck API e web; `nest build`; `next build` | sem erros |
| E2E novo `addons-pos-tabs` | 20/20 |
| **E2E completa** (banco novo `rs_adic_e2e`, 22 migrations) | **NÃO CONCLUÍDA** — iniciada, mas o processo foi encerrado pelo Claude Code por falta de memória na máquina; as 15 suítes cujo resultado chegou ao log passaram, nenhuma falhou. Precisa ser executada de novo (ver pendências) |
| Revisão de interface (Chrome headless, ambiente descartável 3800/4800) | PDV 19/19, comanda 9/9, sem erros de console |

Cenários cobertos (pedido da etapa → teste):
produto sem adicionais; vários adicionais; grupo obrigatório; limites (grupo, adicional, escolha
única); adicional esgotado e grupo inativo; produto esgotado (PDV e rodada); alteração de preço
(venda e comanda); cancelamento (venda com adicionais e unidades da comanda); fechamento da comanda e
comanda fechada; totais do PDV, do caixa e do relatório; histórico do pedido; isolamento entre
restaurantes; permissões (CAIXA, GARÇOM, COZINHA); cozinha (pedido do PDV e rodada da mesa);
idempotência da rodada com adicionais; cupom com adicionais.

## 9. Capturas de tela

Em `docs/capturas/adicionais-pdv-comandas/` (dados fictícios "Burger Lab Teste", banco descartável):

- PDV: `pdv-01-catalogo`, `pdv-02-modal-aberto`, `pdv-03-validacao-obrigatorio`,
  `pdv-04-modal-personalizado`, `pdv-05-carrinho-conferido`, `pdv-06-editar-item`,
  `pdv-06b-observacao-sem-adicionais`, `pdv-07-venda-concluida`, `pdv-08-detalhe-pedido`,
  `pdv-09-tablet-modal` (1024×768).
- Comanda: `comanda-01-modal`, `comanda-02-rascunho`, `comanda-03-rodada-enviada`,
  `comanda-04-duas-rodadas`, `comanda-05-celular` (390×844), `comanda-06-fechar-conta`,
  `comanda-07-conta-fechada`.
- Cozinha: `kds-01-pedido-pdv`, `kds-02-rodadas-mesa`.

## 10. Como testar

1. Banco descartável (nunca o DEV):
   `docker run -d --name rs-teste-pg -e POSTGRES_USER=saas -e POSTGRES_PASSWORD=saas -e POSTGRES_DB=rs_teste -p 127.0.0.1:55480:5432 postgres:16-alpine`
   e um Redis em outra porta.
2. Na worktree `restaurant-saas-adicionais/apps/api`, com `DATABASE_URL`/`REDIS_URL` desse banco:
   `npx prisma migrate deploy`, `npx ts-node prisma/seed.ts`, `npx nest build`.
3. Testes: `npx jest` (unitários) e `npx jest --config ./test/jest-e2e.json` (E2E).
4. Navegador: `pnpm tenant:provision` contra o banco descartável, subir a API
   (`PORT=4800 node dist/src/main.js`) e o web (`API_URL=http://127.0.0.1:4800/v1 npx next build`
   e `npx next start -p 3800`). Cadastrar grupos de adicionais em Cardápio → Adicionais e vinculá-los
   aos produtos; então:
   - PDV: tocar um produto com adicionais → escolher → "Adicionar à venda" → conferir o total
     ("Valores conferidos pelo sistema") → Editar/Remover → Finalizar → Ver pedido.
   - Mesas: abrir comanda → produto com adicionais → "Adicionar à rodada" → Enviar para a cozinha
     → nova rodada → Fechar conta.
   - Cozinha: conferir mesa, rodada, adicionais e observação nos cartões.

## 11. Pendências antes de integrar ao DEV

0. **Rodar a suíte E2E completa até o fim** (`npx jest --config ./test/jest-e2e.json` contra um banco
   descartável com as 22 migrations). A execução desta etapa foi interrompida por falta de memória
   na máquina; até lá a funcionalidade não deve ser considerada concluída.
1. **Aprovação** desta branch para integrar à `salto-desenvolvimento` (não feito, conforme pedido).
2. **Migration 22 no DEV**, com backup restaurável antes (procedimento das migrations 17–21). Sem
   ela, a API nova falha ao ler comandas e o quadro da cozinha. API e web devem subir juntos.
3. **Mudanças de comportamento a comunicar à equipe do restaurante:**
   - o PDV passa a exigir o grupo obrigatório (ex.: produtos da Do'cê com grupo obrigatório não
     saem mais pelo preço base sem a escolha);
   - a rodada da comanda passa a recusar produto marcado como esgotado;
   - o fechamento da comanda passa a gravar a observação e os adicionais nas linhas da venda.
4. Validação manual no DEV com o cardápio real da Do'cê (2 grupos, 27 adicionais) e em um tablet
   físico — não feita nesta etapa (sem acesso ao DEV por regra).
5. Funcionalidades fora do escopo, para decidir: ficha técnica por adicional (baixa de estoque),
   relatório de vendas por adicional, impressão de comanda/cupom (não existe tela de impressão no
   sistema hoje; os adicionais aparecem no detalhe do pedido e no KDS).
6. Limitação conhecida: se um adicional for **excluído** do cardápio entre o envio de uma rodada e
   uma nova tentativa com a mesma chave de idempotência, a nova tentativa responde 409 em vez de
   repetir a rodada (o snapshot já gravado não é afetado).
7. As capturas (2,2 MB) estão versionadas nesta branch; podem ser retiradas antes da integração se
   preferir não guardar imagens no repositório.

## 12. Segurança dos ambientes

Não foram tocados: `restaurant-saas-final`, banco `restaurant_saas_final`, apresentação acadêmica,
`master`, produção, homologação, piloto, demo, DEV (nenhuma conexão), importação Brendi e os 78
produtos da Do'cê. Nenhum push, nenhum deploy. Tudo rodou nos containers descartáveis
`rs-adic-pg` (55480) e `rs-adic-redis` (56480), criados para esta etapa.
