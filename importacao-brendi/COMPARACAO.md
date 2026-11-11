# Brendi × Restaurant SaaS — o cardápio da Do'cê

Análise feita em 10/11/2026, segunda-feira, com a loja **fechada** (abre de quinta a domingo,
19:00). Por isso o carrinho e o checkout da Brendi não puderam ser exercitados: a página bloqueia
"adicionar" fora do horário ("Estamos fechados :( Abrimos quinta às 19:00"). Tudo o que depende
deles está marcado como **não observado**.

Legenda: ✅ já existia no SaaS · 🆕 implementado nesta etapa · ⚠️ diferença que fica · ⏳ pendente.

## O que a Brendi mostra e como ficou no SaaS

| Recurso da Brendi (observado) | SaaS | Observação |
| --- | --- | --- |
| Categorias em ordem definida pela loja | ✅ | 9 categorias com produtos; 2 sem produtos publicados ("Promoção", "Lançamento") não são importadas |
| Nome, descrição, preço, foto | ✅ / 🆕 fotos | Fotos guardadas no próprio banco (`media_assets`), servidas pelo SaaS, sem depender da Brendi |
| Preço promocional "De R$ 35,00 por R$ 32,00" | 🆕 | `compareAtPriceCents`; o banco garante que o "de" é maior que o preço |
| "A partir de" | 🆕 | Mesma regra observada: aparece quando algum adicional pago pode aumentar o preço |
| Selos "Novidade" e "Vegetariano" | 🆕 | `badges` (NEW, VEGETARIAN) |
| "Mais Pedidos" (por vendas) | 🆕 ⚠️ | No SaaS é a faixa "Destaques", marcada pelo restaurante (`featured`); não é calculada por vendas |
| Produto esgotado (seção "Em falta", selo ESGOTADO) | 🆕 | `soldOut`: aparece no fim, em "Em falta", e o pedido é recusado no servidor |
| Grupos de adicionais com mínimo/máximo, contador "0/10", "Obrigatório" | 🆕 | `option_groups` + `option_items` + vínculo por produto; mesmas regras validadas no servidor |
| Máximo por opção, preço por opção, descrição e foto da opção | 🆕 | `maxQuantity`, `priceCents`, `description`, `imageMediaId` |
| Opção em falta escondida | 🆕 | `soldOut` na opção: não é listada e o pedido com ela é recusado |
| Busca de opção dentro do grupo ("Pesquisar") | 🆕 | Campo de busca aparece em grupos com 9 ou mais opções |
| Observação por produto ("Observações sobre o produto") | 🆕 | `order_items.notes` (até 140 caracteres); aparece na cozinha (KDS), no pedido e no acompanhamento |
| Busca no cardápio | 🆕 | Sem acentos e sem diferenciar maiúsculas |
| Abas de categorias que acompanham a rolagem | 🆕 | |
| Capa, logo e cartão da loja (aberto/fechado, cidade) | 🆕 | `coverMediaId`, `logoMediaId`, cor da marca `brandColor`, tudo por restaurante |
| "Abrimos quinta às 19:00" | 🆕 | Calculado no fuso do restaurante |
| Informações da loja: horários, formas de pagamento, WhatsApp | ✅ / 🆕 | Folha "Informações da loja" com horários, como pedir, pagamento, endereço e WhatsApp |
| Pedido mínimo R$ 21,00 | ✅ ⚠️ | No SaaS o mínimo vale para **entrega**; a Brendi mostra o mínimo sem dizer se vale para retirada |
| Taxa de entrega por faixa de distância (R$ 3 até 5 km e até 10 km) | ⚠️ | O SaaS tem taxa fixa por unidade. Como as duas faixas custam R$ 3,00, o valor é o mesmo; a distância máxima de 10 km não é verificada |
| Entrega grátis acima de R$ 23,00 | 🆕 | `deliveryFreeAboveCents` na unidade: a taxa vira zero quando os itens chegam ao valor |
| Tempo estimado (entrega 30–40 min, retirada 50–60 min) | ⏳ | O SaaS não exibe tempo estimado |
| Retirada no local | ✅ | |
| Consumo no local (balcão/mesa pelo cardápio) | — | Desligado na Do'cê; o SaaS tem mesas/comandas pelo garçom |
| Agendamento de pedidos (até 8 dias) | ⏳ | Não existe no SaaS |
| Pausas programadas ("Manutenção", "Falta de energia") | ⏳ | O SaaS só tem o horário semanal |
| Pagamento online (Pix, cartão, Apple Pay, Google Pay) | ⚠️ | Fora do escopo: o SaaS registra a forma de pagamento escolhida (dinheiro, Pix, cartão) para pagar na entrega/retirada; não processa pagamento |
| Pagamento na entrega: dinheiro, crédito, débito | ✅ | Dinheiro, Pix e Cartão (o SaaS não separa crédito/débito no cardápio) |
| Login do cliente, "Aproveite benefícios" | ⚠️ | O SaaS tem fidelidade/cashback para clientes cadastrados no balcão; o cardápio público é sem login. Na Do'cê, fidelidade e cashback estão desligados na Brendi |
| Cupons | ✅ | O SaaS aceita código de cupom no checkout (a Brendi não tinha cupons ativos no cardápio) |
| Banner promocional ("Combo 3 X Tudo R$ 89,90") | ⏳ | Imagem baixada (`imagens/banner-1.jpg`), mas o SaaS ainda não tem carrossel de banners |
| Compartilhar produto | ✅ parcial | Cada produto tem endereço próprio (`/menu/<slug>/produto/<id>`); não há botão de compartilhar |
| "Serve 1 pessoa" (porção) | ⏳ | Só 1 produto usa (e está esgotado); não importado |
| Pixel do Facebook, Clarity, PostHog | — | Não reproduzido de propósito (privacidade; o SaaS não envia nada para terceiros) |
| Carrinho e checkout da Brendi | ❓ não observado | Loja fechada durante a análise |

## Recursos do SaaS que a importação não usa

- Receitas e estoque: os adicionais **não** baixam estoque nem têm ficha técnica; os produtos
  importados entram sem receita (nada foi inventado). A checagem de estoque do pedido (B2) só
  atua em produtos com receita.
- PDV e comandas: ainda vendem o produto pelo preço base, sem adicionais (o grupo obrigatório não
  é exigido no balcão). O pedido online é o único canal com adicionais nesta etapa.
- Relatórios: o valor dos adicionais entra no preço unitário da linha (vendas por produto
  incluem os adicionais); não há relatório por adicional.

## Números da extração (10/11/2026 20:47 UTC)

| Item | Quantidade |
| --- | --- |
| Categorias | 11 (9 com produtos publicados) |
| Produtos publicados | 78 (69 disponíveis + 9 esgotados) |
| Produtos listados mas não publicados (sem dados) | 33 |
| Grupos de adicionais | 2 ("Turbine seu lanche!" 0–10, "Refrigerante combo" 1–5 obrigatório) |
| Opções | 27 (23 pagas, 4 sem custo; 1 esgotada) |
| Produtos com adicionais | 30 |
| Preços promocionais | 2 |
| Fotos | 80 (75 produtos, 1 opção, logo, capa, 1 banner); 3 produtos sem foto |
