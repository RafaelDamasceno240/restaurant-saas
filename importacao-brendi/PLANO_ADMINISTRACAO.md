# Plano — administração do cardápio novo pelo painel

Análise feita em 10/11/2026, na branch `cardapio-brendi`. **Nada disto foi implementado**: o
pedido foi saber o que existe, o que falta e os riscos antes de começar.

**Situação em 11/11/2026:** o plano está fechado e continua **sem implementação**. A decisão de
começar, e por qual prioridade (P0 a P3, seção 3), é do responsável pelo projeto. O único item da
lista que já mudou foi a identidade visual do painel por restaurante (seção 1).

Hoje os dados novos da migration 21 (adicionais, foto no banco, esgotado, preço "de",
destaque, selos, logo, capa, cor) **só são gravados pelo importador** (`pnpm menu:import`).
O cardápio público e o pedido já usam tudo isso; o painel ainda não edita.

## 1. O que já existe no painel

| Tela | Rota | O que faz hoje | Permissão (já existente) |
| --- | --- | --- | --- |
| Cardápio | `/dashboard/cardapio` | Categorias e produtos: criar, editar, duplicar, excluir, **pausar/ativar** (some do cardápio), ordem, preço, descrição, **URL** de imagem | `products.*`, `categories.*` (OWNER, ADMIN, MANAGER) |
| Restaurante | `/dashboard/restaurante` | Nome, descrição, contatos, endereço, horários | `restaurant.update` (OWNER, ADMIN) |
| Delivery | `/dashboard/delivery` | Entrega ligada, taxa, pedido mínimo e, **novo nesta branch**, "entrega grátis a partir de" | `delivery.configure` |
| Painel (barra lateral, perfil) | todas | **Corrigido nesta revisão:** mostra o nome e o logo do próprio restaurante (iniciais quando não há logo) | — |

Lacunas que o proprietário vai notar logo:

- **Fotos importadas não aparecem na tela Cardápio do painel.** A API administrativa devolve só
  `imageUrl` (URL externa); as fotos importadas estão em `imageMediaId`. O cardápio público
  mostra as fotos normalmente.
- **"Esgotado" não tem botão.** O painel só tem "pausar", que **esconde** o produto. "Esgotado"
  deixa o produto visível, apagado, sem poder pedir, como na Brendi.
- **Editar no painel e depois reimportar desfaz a edição.** O importador trata a Brendi como
  fonte: rodar de novo devolve preço, esgotado e ativo dos itens importados aos valores do
  arquivo. Depois que o restaurante passar a usar o painel, **a importação não deve ser repetida**
  (ou ganhar um modo "só novos", ver P3).

## 2. O que precisa ser criado, por item pedido

| Item | API | Tela | Esforço* | Riscos |
| --- | --- | --- | --- | --- |
| **Disponibilidade** (esgotado, destaque, preço "de", selos) | Aceitar `soldOut`, `featured`, `compareAtPrice`, `badges` no `PATCH /products/:id` (as colunas e as checagens do banco já existem) | Botão "Esgotado" na lista (como o de pausar) e campos no formulário do produto | **P** (½ dia) | Baixo. Testes de formato exato da API de produtos precisam incluir os campos novos |
| **Foto do produto no painel** | Campo `photoUrl` (só leitura) na resposta administrativa. **Não** reaproveitar `imageUrl`: ele exige URL `http(s)` e salvar um produto importado quebraria | Lista e formulário mostram a foto; o campo URL continua para quem cola um link | **P** (2 h) | Baixo |
| **Adicionais dos produtos** (grupos, opções, preços, esgotado por opção) | CRUD de `option_groups` e `option_items` sob `products.*`; validação mín./máx. igual à do banco | Tela nova "Adicionais": grupos com suas opções, ordem, preço, máximo por opção, esgotado, ativo | **G** (2–3 dias) | **Médio.** Um grupo é **compartilhado**: "Turbine seu lanche!" está em 29 produtos, e editar muda todos (a tela precisa dizer isso). Pedidos antigos estão protegidos (nome e preço congelados em `order_item_options`). Excluir opção com pedidos: desativar, não apagar |
| **Opções obrigatórias** | Mesmo CRUD (mín. ≥ 1 torna obrigatório) + vínculo produto↔grupo (`product_option_groups`) | No formulário do produto: escolher grupos e ordem; no grupo: mínimo e máximo | **M** (1 dia, junto do item acima) | **Médio.** Grupo obrigatório sem opção disponível deixa o produto esgotado no cardápio, por regra. O PDV e as comandas ainda vendem sem adicionais (ver P3) |
| **Logo e capa** | Endpoint de envio (`multipart`) que reusa `checkImage` (JPEG/PNG/WebP pelos bytes, até 3 MB), grava em `media_assets` e troca `logoMediaId`/`coverMediaId`; auditoria | Na tela Restaurante: enviar, ver e remover logo e capa | **M** (1–1,5 dia) | **Médio.** É o primeiro envio de arquivo do sistema (hoje não há nenhum): limite de tamanho no proxy do web, limite de requisições, só `restaurant.update`. As imagens ficam no banco: ok para logo, capa e ~80 fotos; para muito mais, um armazenamento de arquivos |
| **Cor da marca** | Aceitar `brandColor` (#RRGGBB) no `PATCH` do perfil (a checagem no banco já existe) | Seletor de cor com prévia e aviso de contraste | **P** (½ dia) | Baixo. Cor clara demais deixa botões ilegíveis: avisar ou bloquear pelo contraste |

\*P = até meio dia, M = cerca de 1 dia, G = 2 a 3 dias, cada um com testes unitários, E2E e
verificação no navegador. São estimativas, não prazo.

Nenhum item exige permissão nova: todos cabem em `products.*`, `restaurant.update` e
`delivery.configure`, que já existem e já estão distribuídas entre os papéis.

## 3. Ordem sugerida

1. **P0 — o painel mostra o que foi importado** (≈ ½ dia): foto no painel, botão "Esgotado",
   destaque, preço "de" e selos no formulário. É o mais usado no dia a dia (esgotar um item numa
   sexta à noite) e tem risco baixo.
2. **P1 — adicionais e opções obrigatórias** (≈ 3 dias): a tela grande. Sem ela, mudar o preço
   do bacon exige reimportar.
3. **P2 — logo, capa e cor** (≈ 1,5–2 dias): muda pouco depois de configurado; até lá o
   importador (`--incluir-loja`, `--cor-marca`) resolve.
4. **P3 — fora do painel, mas ligado:** adicionais no PDV e nas comandas (hoje vendem pelo preço
   base); modo "só novos" no importador; relatório de vendas por adicional.

## 4. Riscos gerais

- **Fonte da verdade.** Antes da P1, a Brendi (via importador) é a fonte; depois, o painel. A
  virada precisa ser combinada: a última importação é feita, e daí em diante só o painel.
- **Atraso de até 10 s no cardápio público.** O servidor web guarda o cardápio por 10 segundos
  (correção desta revisão, ver o relatório). Um item esgotado no painel some do cardápio em até
  10 s. O pedido é sempre conferido na API, então nunca se vende algo esgotado ou pelo preço
  antigo.
- **Testes de formato exato.** Vários E2E comparam a resposta inteira (`toEqual`). Cada campo novo
  exige atualizar esses testes, como aconteceu na migration 21.
- **Sem migration nova** para P0, P1 e a cor: as colunas e checagens já existem desde a 21. Logo e
  capa também não precisam de migration.
