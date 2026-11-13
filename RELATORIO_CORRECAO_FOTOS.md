# Relatório — Correção da exibição das fotos dos produtos

Data: 13/11/2026.
Branch: `correcao-fotos-produtos`, na worktree `restaurant-saas-fotos`, criada a partir da
`salto-desenvolvimento` em `2a1d6a5`.
Commit **`79cd2ab`** (código e testes). Tudo é **local**: sem merge, sem push, sem deploy. Nada foi
aplicado ao DEV.

## 1. Problema

Os produtos importados da Brendi têm foto, mas algumas telas mostravam o ícone genérico no lugar
dela:
- o PDV;
- a lista de fichas técnicas;
- o carrinho público montado pelo link do WhatsApp.

O cardápio público mostrava as fotos normalmente.

## 2. Causa (investigação sem alterar dados)

**Como as fotos estão gravadas:**
- Uma foto enviada ou importada fica em `media_assets` e o produto aponta para ela por
  `imageMediaId`. O campo `imageUrl` guarda **só** um link externo colado à mão.
- No DEV (consulta só de leitura), a Do'cê tem **75 produtos com `imageMediaId` e nenhum com
  `imageUrl`**. Outros restaurantes, de teste, têm só `imageUrl` (link colado).

**Como o cardápio público acerta:** ele resolve a foto com
`publicImageUrl(imageMediaId, imageUrl)` (`apps/api/src/modules/media/media-url.ts`). O resultado
é `/api/public/media/<id>` quando há foto enviada ou importada, senão o link colado.

**Onde cada tela errava:**

| Tela | O que lia | Resultado nos importados |
| --- | --- | --- |
| PDV (`apps/web/app/dashboard/pdv/page.tsx`) | `product.imageUrl` (o link cru), embora a API de produtos **já devolvesse** `photoUrl` resolvido | Ícone |
| Fichas técnicas (`GET /inventory/recipes`, `recipes.service.ts`) | A API devolvia `product.imageUrl` cru | Ícone |
| Carrinho do link do WhatsApp (`GET /public/whatsapp-carts/...` + `cartFromShared`) | A API não devolvia foto, e o web gravava `imageUrl: null` | Ícone |

A tela de mesas não mostra foto de produto: isso é escolha de layout, não defeito. O painel do
cardápio (`MenuAdmin`) já usava `photoUrl`.

## 3. Correção

Todas as telas passaram a usar o **mesmo mecanismo do cardápio público** (`publicImageUrl`):

| Arquivo | Mudança |
| --- | --- |
| `apps/web/app/dashboard/pdv/page.tsx` | Usa `product.photoUrl`, que a API já entregava |
| `apps/api/src/modules/inventory/recipes.service.ts` | `imageUrl` da lista de fichas = `publicImageUrl(imageMediaId, imageUrl)` |
| `apps/api/src/modules/whatsapp/whatsapp-checkout.service.ts` | Cada linha do carrinho do link ganha `imageUrl` resolvido, com **uma** consulta filtrada pelo restaurante do link (`tenantId` + ids dos produtos) |
| `apps/web/lib/whatsapp-api.ts`, `apps/web/lib/whatsapp-logic.ts` | O tipo aceita `imageUrl`; `cartFromShared` repassa a foto ao carrinho público (`?? null`) |

**Garantias:**
- **Nenhum dado alterado ou duplicado:** nenhuma foto foi copiada; todas as telas apontam para a
  mesma URL pública. Os produtos importados não foram tocados, e não há migration.
- **Sem foto:** o produto continua com o ícone genérico.
- **Link colado:** continua funcionando, porque é o caminho de reserva do `publicImageUrl`.
- **Isolamento:**
  - o carrinho do link só busca produtos do restaurante dono do link;
  - as listas do PDV e da ficha técnica já eram filtradas por restaurante;
  - testado nos dois sentidos.
- **Nada interno exposto:** a URL é a rota pública que já servia o cardápio (`/api/public/media/<uuid>`,
  com cabeçalhos `nosniff`, CSP `sandbox` e bloqueio para restaurante suspenso). Não aparece
  nenhum caminho de disco ou de banco.

## 4. Testes

| Teste | Resultado |
| --- | --- |
| Unitários da API | **49 suítes / 486 testes** |
| Unitários do web | **44 suítes / 456 testes** (+1: carrinho com e sem foto) |
| Typecheck da API e do web | sem erros |
| Lint (ESLint da API nos arquivos alterados; `next lint`) | sem erros |
| Build de produção | API (`nest build`) e web (`next build` com `API_URL=http://127.0.0.1:4950/v1`) sem erros |
| E2E novo `product-photos.e2e-spec.ts` | 2/2. Foto importada, link colado e sem foto dão **a mesma URL** em `/products` (PDV), `/inventory/recipes` e no cardápio público; a mídia é servida como `image/png`; outro restaurante não vê os produtos nem as fotos |
| E2E do WhatsApp (ampliado) | 17/17. A linha do link vem sem foto, depois com `/api/public/media/<id>` quando há foto importada; o subtotal não muda |
| E2E afetados (inventory, menu-admin, public-menu, menu-options) | todos passaram |
| **E2E completa** (banco novo `rs_integ_fotos_full`, um processo) | **67/67 suítes, 972/972 testes**, numa única execução (403 s) |

Um primeiro erro no E2E do WhatsApp foi **do meu teste**: o `sha256` fictício não era
hexadecimal, e o banco tem uma regra que exige isso (`media_assets_sha256_hex`). Corrigido no
próprio teste, que depois passou.

### Navegador (ambiente descartável)

**Ambiente:**
- web 3950 → API 4950 → banco `rs_integ_browser`;
- restaurante fictício "Do'cê Integração (teste)", com o **cardápio real da Do'cê** importado:
  75 fotos e 3 produtos sem foto.

**Resultado: 13 verificações aprovadas.**

| Verificação | Resultado |
| --- | --- |
| PDV | **75/75 fotos carregadas**; os 3 produtos sem foto ("Água sem gás", "Suco latinha pêssego", "Água com gás") mantêm o ícone |
| Preços e adicionais no PDV | Smash Clássico + Bacon = **R$ 34,00** no modal e no carrinho cotado pelo servidor (igual a antes) |
| Fichas técnicas | **75/75 miniaturas** com a foto; amostras servidas com 200 `image/jpeg` |
| WhatsApp → link → carrinho público | Foto do produto carregada; **R$ 34,00** com "+ Bacon" |
| Checkout | Mesmo total, sem fiado; pedido **MWEHE8VG-1EE6** confirmado (ONLINE, PIX), gravado com Smash R$ 30,00 + Bacon R$ 4,00 |
| Cardápio público | Fotos como antes (nenhuma imagem quebrada) |
| Isolamento | O PDV do outro restaurante não mostra nenhuma foto nem produto da Do'cê |
| Console | Sem erros na segunda parte do roteiro. Na primeira parte, o roteiro travou no cardápio, por causa das imagens carregadas sob demanda, antes de checar o console; as verificações daquela parte já tinham passado e foram repetidas com espera limitada |

**Capturas** (`docs/capturas/correcao-fotos/`):
- **antes:** `antes-01-pdv-icones.png`, `antes-02-carrinho-whatsapp-icone.png`;
- **depois:** `fotos-01` a `fotos-07`.

## 5. Ambientes

- **DEV:** não foi alterado. O banco continua com 64/64 tabelas idênticas às da última
  conferência, e nada foi aplicado.
- **FINAL:** `restaurant-saas-final` em `e04d4a7`, sem alterações. Banco com 51/51 tabelas
  idênticas.
- **Git:** `master` em `a23be9a`; `salto-desenvolvimento` em `2a1d6a5` (sem merge).
- **Containers descartáveis:** `rs-adic-pg` e `rs-adic-redis` foram religados só para os testes e
  parados de novo no fim, como estavam depois da fase 1.
- **Docker e WSL:** não foram reiniciados. Nenhum volume, imagem ou container foi apagado.
- **Cardápio da Do'cê:** não foi reimportado.

## 6. Para levar ao DEV (com a sua aprovação)

- **Integração:** merge da branch `correcao-fotos-produtos` na `salto-desenvolvimento`.
- **Banco:** não há migration nem seed, e nenhum dado muda.
- **Publicação:** reconstruir a API e o web juntos (web com `API_URL=http://127.0.0.1:4100/v1`) e
  religar os dois.
- **Resultado esperado no DEV:** as 75 fotos da Do'cê passam a aparecer no PDV, nas fichas técnicas
  e no carrinho que vem do WhatsApp.
