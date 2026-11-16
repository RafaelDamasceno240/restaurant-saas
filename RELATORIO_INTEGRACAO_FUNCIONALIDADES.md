# Relatório — Integração das três funcionalidades (versão temporária)

Data: 12/11/2026
Branch temporária: `integracao-funcionalidades-2026-11` (worktree `restaurant-saas-integracao`,
criada a partir de `salto-desenvolvimento` em `c866ff5`). Tudo é **local**: sem merge na
`salto-desenvolvimento`, sem push, sem deploy, nada aplicado ao DEV.

## 1. Branch temporária criada

- As três branches originais **não foram alteradas** e continuam onde estavam:
  - `adicionais-pdv-comandas` em `da77cb5`;
  - `assistente-whatsapp` em `3aba816`;
  - `remocao-fiado` em `370b8b6`.
- A integração foi feita com `merge --no-ff`, nesta ordem: adicionais, WhatsApp, fiado.
  - Essa é a ordem das migrations: a dos adicionais é das 12:00 e a do WhatsApp das 20:00.
  - Assim, a migration de cada branch entra na sequência certa.
- Resultado frente à `salto-desenvolvimento`: 153 arquivos alterados, +12.626 / −2.439 linhas.

| Commit | O que é |
| --- | --- |
| `65235b7` | Merge de `adicionais-pdv-comandas` (sem conflito) |
| `b47bab3` | Merge de `assistente-whatsapp` (sem conflito textual) |
| `2d062c0` | Merge de `remocao-fiado` (5 conflitos, todos em imports; seção 2) |
| `2ae6e9e` | Ajustes de compatibilidade que só apareceram no código integrado (seção 2) |
| `d6ef2a8` | Correção do assistente de WhatsApp encontrada com o cardápio real (seção 5) |
| (este relatório) | Relatório e capturas |

## 2. Conflitos encontrados e resoluções

### 2.1 Conflitos textuais (merge de `remocao-fiado`)

Os cinco conflitos estavam só nas linhas de `import`, porque as duas branches mexeram nos mesmos
arquivos. Nenhum trecho de lógica conflitou. Em todos, as duas funcionalidades foram mantidas.

| Arquivo | Resolução |
| --- | --- |
| `api/.../pos/dto/create-pos-order.dto.ts` | Linha do PDV com adicionais (`StaffOrderLineDto`) + formas de pagamento sem fiado (`SALE_PAYMENT_METHODS`); `CreditTermsDto` removido |
| `api/.../public-orders/dto/create-order.dto.ts` | Adicional por unidade (`OrderLineOptionDto`) + `SALE_PAYMENT_METHODS` |
| `web/lib/tabs-api.ts` | Mantido `ItemsQuote` (cotação da rodada); removido `CreditTerms` (fiado) |
| `web/app/dashboard/pdv/page.tsx` | Mantido o ícone `Pencil` (editar linha com adicionais); removido `NotebookPen` (botão Fiado) |
| `web/app/dashboard/mesas/[tableId]/page.tsx` | Imports do modal de adicionais e da cotação + imports de pagamento sem fiado (`paidWithLabel`, `TAB_PAYMENT_OPTIONS` só com dinheiro/PIX/cartão) |

### 2.2 Incompatibilidades sem conflito textual (commit `2ae6e9e`)

O merge "passou", mas o typecheck do código integrado acusou dois erros. Nenhuma das branches,
sozinha, teria mostrado nenhum deles:

1. **WhatsApp × adicionais:**
   - os adicionais tornaram `PricedOption.optionItemId` anulável (`string | null`), porque uma
     rodada antiga copiada para o pedido pode ter um adicional que foi excluído depois;
   - o assistente de WhatsApp esperava sempre um id;
   - um adicional precificado na hora sempre tem id, então o assistente continua exigindo o id e
     falha de forma explícita se isso um dia mudar.
2. **Adicionais × remoção do fiado:**
   - o teste unitário `order-creation.quote.spec.ts` (dos adicionais) montava o
     `OrderCreationService` com 8 dependências;
   - a remoção do fiado tirou o `ReceivablesService` dele, que agora tem 7.

### 2.3 Testes preservados

| | Arquivos de teste | E2E |
| --- | --- | --- |
| `salto-desenvolvimento` | 151 | 64 |
| `adicionais-pdv-comandas` | 154 | 65 |
| `assistente-whatsapp` | 156 | 65 |
| `remocao-fiado` | 151 | 64 |
| **Integração** | **159** | **66** |

A integração tem a união dos testes das três branches. A única exceção é
`receivables-orders.e2e-spec.ts`, que a própria remoção do fiado apagou: ele testava *vender*
fiado. As garantias que ele dava sobre dívidas existentes foram levadas para
`fiado-disabled.e2e-spec.ts`.

## 3. Migrations presentes

São 23 migrations no total: as 21 da base e mais duas novas. A remoção do fiado **não tem
migration**.

| Nº | Migration | Branch | O que faz |
| --- | --- | --- | --- |
| 22 | `20261112120000_tab_item_options` | adicionais | Cria só a tabela `tab_item_options` (2 FKs, 2 índices, 2 CHECKs) |
| 23 | `20261112200000_whatsapp_assistant` | WhatsApp | Cria só 7 enums e 7 tabelas `whatsapp_*` (FKs, índices, CHECKs) |

**Convivência das duas migrations:**
- As duas são **puramente aditivas**: nenhum `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` ou `RENAME`.
- Nenhum `ALTER TABLE` mexe numa tabela existente: os `ALTER` só adicionam constraints às
  tabelas que a própria migration acabou de criar.
- Não há nome de tabela, tipo ou índice em comum entre elas.
- Os nomes começam pela data e hora, então a ordem fica a mesma em qualquer sequência de merge.

**Teste de atualização num banco com histórico** (`rs_integ_legacy`, cópia descartável do banco
da E2E da remoção do fiado):
- o banco tinha 21 migrations, 687 pedidos (22 fiados), 74 contas a receber e 156 lançamentos;
- calculei um hash de cada uma das 55 tabelas, apliquei as migrations 22 e 23 e recalculei;
- **as 55 tabelas ficaram idênticas** e as 8 tabelas novas foram criadas vazias;
- `prisma migrate status`: "Database schema is up to date" (23/23);
- `prisma migrate diff` não acusou nenhuma diferença, nem entre as migrations e o
  `schema.prisma`, nem entre o banco e o `schema.prisma`.

**Banco novo do zero:** 23 migrations aplicadas e seed com **72 permissões**. As 70 da base,
menos `receivables.sell` (fiado), mais `whatsapp.read`, `whatsapp.reply` e `whatsapp.configure`.

Tudo isso foi feito apenas em bancos descartáveis (container `rs-adic-pg`, bancos `rs_integ_*`).

## 4. Testes executados e resultados

| Teste | Resultado |
| --- | --- |
| Typecheck API e web | sem erros (depois do commit `2ae6e9e`) |
| Lint API (`eslint src test`) e web (`next lint`) | sem avisos nem erros |
| Unitários da API | **49 suítes / 486 testes — todos passaram**. São 483 = 448 da base + 13 dos adicionais + 31 do WhatsApp − 9 do fiado, exatamente a soma esperada, mais os 3 da correção da seção 5 |
| Unitários do web | **44 suítes / 455 testes — todos passaram** (444 da base + 17 + 4 − 10) |
| Build de produção | API (`nest build`) e web (`next build`, com `API_URL` do ambiente descartável) sem erros |
| E2E completa — execução 1 (`rs_integ_full`) | 65/66 suítes, 953/970 testes. Os 17 que falharam são todos da suíte do WhatsApp, que parou na própria verificação inicial: faltavam no **meu** ambiente de teste as duas credenciais fictícias que ela exige (`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`). Erro de preparação, não do código |
| E2E completa — execução 2 (`rs_integ_full2`, variáveis corrigidas) | 64/66 suítes, 968/970 testes. As 2 falhas (1 do WhatsApp, 1 de `tab-kitchen-flow`) foram **tempo esgotado** (limite de 5 s do Jest), sem nenhuma verificação errada; a suíte de comandas levou 65 s nessa execução |
| As 2 suítes da execução 2, repetidas sozinhas | **`tab-kitchen-flow` 36/36 e `whatsapp` 17/17 — todas passaram** (29 s e 8 s) |
| **E2E completa — execução 3** (`rs_integ_full3`, banco novo, código final com a correção da seção 5) | **66 de 66 suítes, 970 de 970 testes — todos passaram numa única execução** (407 s). É exatamente a soma esperada: 952 da base + 20 dos adicionais + 17 do WhatsApp − 19 do fiado |

Todas as E2E rodaram com um processo só (`--runInBand`), sem navegador, API ou web de revisão
ligados ao mesmo tempo. O pico de memória do Jest foi de cerca de 1,5 GB.

## 5. Validação dos fluxos combinados (navegador)

**Ambiente descartável:**
- banco `rs_integ_browser`, API na porta 4950, web na 3950 (build de produção), Chrome headless;
- dois restaurantes fictícios:
  - **"Do'cê Integração (teste)"**, com o **cardápio real da Do'cê** importado pela ferramenta
    oficial (`menu:import`, simulação e depois aplicação): 78 produtos, 2 grupos, 27 adicionais
    e 75 fotos, os mesmos números da importação no DEV;
  - "Outro Restaurante (teste)", para conferir o isolamento.
- Os dados reais da Do'cê no DEV não foram tocados: a fonte foi o arquivo
  `importacao-brendi/dados/cardapio.json`, com as fotos da pasta local da extração.
- Uma venda fiada **antiga** foi criada pelo mesmo utilitário de teste da E2E: um pedido do PDV
  pago com PIX, transformado em fiado de R$ 60,00 em 2 parcelas, com a primeira já vencida.

**Resultado: 36 verificações no navegador e 5 chamadas diretas à API, todas aprovadas** no
código final, sem erro no console. Capturas em `docs/capturas/integracao-funcionalidades/`.

| Fluxo | O que foi conferido |
| --- | --- |
| Cardápio público | Categorias e produtos reais, fotos importadas carregando, nenhuma menção a fiado, página do "Combo Batata + Refri" com o grupo obrigatório "Refrigerante combo" e as 4 bebidas |
| PDV com adicionais e sem fiado | Formas de pagamento: só Dinheiro, Pix e Cartão. Grupo real "Turbine seu lanche!": Smash Clássico + Bacon + Ovo = R$ 36,00 no modal, com observação. O combo não entra sem escolher o refrigerante. Carrinho cotado pelo servidor: R$ 50,99. Venda em **dinheiro** concluída (caixa aberto) e venda no **cartão** concluída (R$ 30,00) |
| Comandas com adicionais e sem fiado | Rodada com Duplo Smash Bacon + Cebola Caramelizada (R$ 38,00) e combo com Guaraná: rascunho de R$ 52,99 cotado pelo servidor. A rodada enviada mantém os adicionais e a observação. O fechamento oferece só CASH/PIX/CARD, sem nenhum texto de fiado. Conta fechada em **PIX** (R$ 52,99). A cozinha mostra os adicionais do PDV e da mesa |
| Fiado antigo | Em "Contas a receber" aparecem a conta de R$ 60,00 vencida e o aviso "O sistema não vende mais fiado", sem botão "Lançar dívida". O histórico de pedidos mostra a venda como "Fiado". Pela API: recebimento de R$ 20,00 em dinheiro aceito (200), restando R$ 40,00 |
| Bloqueio de fiado novo | Pela API: venda `ON_ACCOUNT` no PDV recusada (400, "Venda fiado não é mais aceita..."); `POST /receivables` e `PUT .../limit` não existem mais (404) |
| WhatsApp sem fiado | Pergunta "posso pagar fiado?": responde "O pagamento é feito na hora... Não trabalhamos com fiado". O resumo do pedido não oferece pagar depois |
| Carrinho criado pelo WhatsApp | Cardápio real: "quero 1 smash clássico com bacon" dá R$ 34,00 (30 + 4). O combo pergunta o refrigerante e "coca cola zero" responde a pergunta. Subtotal de R$ 48,99, calculado pelo sistema. Resumo, "sim" e o link de checkout |
| Checkout | O link abre "Seu pedido do WhatsApp" com o subtotal de R$ 48,99. O carrinho público vem preenchido com os adicionais. O checkout oferece Dinheiro/Pix/Cartão, sem fiado. Pedido **confirmado** (#MWDTIK6E-3A15, ONLINE, PIX, R$ 48,99), gravado com os adicionais (Bacon R$ 4,00; Coca cola zero lata 350ml) |
| Isolamento | O outro restaurante não vê as conversas, as dívidas nem os produtos da Do'cê |

**Problema real encontrado e corrigido (commit `d6ef2a8`):**
- **O que aconteceu:**
  - o assistente local perguntou o refrigerante do combo e o cliente respondeu "coca cola zero";
  - o assistente só aceitava o nome completo da opção ("Coca cola zero lata 350ml"), então
    procurou um produto com esse nome;
  - achou o "Coca Cola 2L Zero" (R$ 16,00), que existe no cardápio real, adicionou esse produto
    e deixou o combo de fora.
  - Captura de antes da correção: `int-11a-whatsapp-antes-da-correcao.png`.
- **Por que não apareceu antes:** os cardápios fictícios da branch do WhatsApp não tinham nenhum
  produto com nome parecido com um adicional. Só o cardápio real mostrou o problema.
- **O que mudou:**
  - enquanto há uma escolha pendente, uma resposta cujas palavras estão todas em **uma única**
    opção do grupo escolhe essa opção;
  - se a resposta servir para mais de uma opção (por exemplo, "coca"), o assistente pergunta de
    novo em vez de procurar outro produto;
  - sem escolha pendente, a busca de produtos não mudou.
- **Testes:** 3 testes unitários novos; 2 deles falham sem a correção.
- **Onde está:** a correção ficou **só na branch de integração**, porque a branch
  `assistente-whatsapp` foi preservada como estava.

## 6. Riscos e pendências

1. **E2E numa execução única:** resolvido. A execução 3 passou inteira (66/66, 970/970) com o código final.
2. **Fotos no PDV e no carrinho vindo do WhatsApp:** os produtos importados guardam a foto em
   `imageMediaId`, mas o PDV e o carrinho montado pelo link do WhatsApp mostram só `imageUrl`,
   então aparece o ícone padrão. Isso já acontece na `salto-desenvolvimento` (o PDV não foi
   alterado nesse ponto) e não é efeito da integração. O cardápio público mostra as fotos.
3. **Correção do WhatsApp fora da branch original:** se a integração definitiva for feita a
   partir das branches originais, e não desta, o commit `d6ef2a8` precisa ir junto.
4. **Variáveis do WhatsApp:** a API só recebe mensagens reais com `WHATSAPP_APP_SECRET` e
   `WHATSAPP_VERIFY_TOKEN` configurados. Sem elas, o módulo fica no modo simulado. Nada disso foi
   configurado no DEV, e a conexão com a Meta continua pendente.
5. **Cartão de crédito × débito:** continua uma única forma, "Cartão" (decisão pendente da
   remoção do fiado).
6. **Clientes com fiado em aberto no DEV:** continuam regularizáveis em "Contas a receber". Vale
   contar quantos são antes de levar ao DEV. A linha antiga da permissão `receivables.sell` fica
   sem uso no banco até uma limpeza opcional, com backup.
7. **Tempo das suítes sob carga:** com a máquina carregada, testes perto do limite de 5 s do
   Jest podem estourar o tempo (execução 2). Isso não muda o resultado das verificações, mas a
   E2E deve rodar com a máquina livre.

## 7. Commit local da integração temporária

Os commits estão na tabela da seção 1. Este relatório e as capturas entram num commit próprio,
logo depois do `d6ef2a8`.

## 8. Está seguro levar ao DEV?

**Sim, do ponto de vista técnico: o código integrado está pronto para ir ao DEV.** Isso vale
desde que a integração siga as condições abaixo e tenha a sua aprovação.

**Evidências:**
- As três funcionalidades convivem sem conflito de lógica: os conflitos eram só de imports, e as
  2 incompatibilidades de tipo foram corrigidas.
- Typecheck, lint, builds e unitários (486 + 455) passam.
- A E2E completa passou numa única execução (66/66, 970/970).
- As duas migrations são aditivas e preservam os dados existentes (55/55 tabelas idênticas
  depois de aplicá-las), sem drift.
- O navegador confirmou os fluxos combinados com o cardápio real da Do'cê.
- O único problema real encontrado (assistente × nomes do cardápio real) foi corrigido e
  ganhou testes.

**Condições para fazer:**
1. Fazer **backup do DEV** e testar a restauração antes das migrations 22 e 23 (o DEV está em
   21).
2. Integrar **a partir desta branch**, para levar junto os commits `2ae6e9e` e `d6ef2a8`. Se
   preferir integrar as branches originais, esses dois commits precisam ir junto.
3. Publicar API e web **juntas**: o web novo depende das rotas novas (cotação do PDV e da
   rodada, WhatsApp) e não oferece mais fiado.
4. Antes, contar os clientes do DEV com fiado em aberto, para saber o que ainda será recebido
   pela tela "Contas a receber".
5. O WhatsApp entra no DEV **só em modo simulado**. A conexão com a Meta é uma etapa separada.

Nada disso foi feito: a integração ao DEV aguarda a sua aprovação.

## Ambientes não tocados

- DEV (nenhuma conexão, nenhuma migration).
- `master`, GitHub, produção (Vercel e Railway).
- `restaurant-saas-final` e a apresentação acadêmica.
- As três branches originais e os dados reais da Do'cê.
- O WhatsApp real (nenhuma conexão, nenhuma mensagem).
- Nenhum histórico financeiro foi apagado.
- O `pnpm install` desta worktree reativou os hooks do Git (`core.hooksPath`) na configuração
  compartilhada do repositório. Isso foi desfeito na hora, como já tinha sido pedido antes.
