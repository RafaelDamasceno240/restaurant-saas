# Relatório — Integração da correção das fotos ao DEV

Data: 13/11/2026.
Origem: branch `correcao-fotos-produtos` (worktree `restaurant-saas-fotos`), commits `79cd2ab`
(código e testes) e `18bffed` (relatório e capturas).
Destino: `salto-desenvolvimento`.
Autorização: o roteiro "INTEGRAR CORREÇÃO DAS FOTOS AO DEV" e a confirmação "Integrar ao DEV",
pedida depois da pré-verificação.

Tudo é **local**: sem push, sem deploy, sem produção. A `master` continua em `a23be9a`, igual ao
`origin/master`.

## 1. Commit da integração

| | |
| --- | --- |
| Merge | **`c6950cf`** — `Merge branch 'correcao-fotos-produtos' into salto-desenvolvimento` (`--no-ff`, histórico preservado) |
| Antes | `salto-desenvolvimento` em `2a1d6a5`, sem commits novos desde a criação da branch das fotos (merge sem divergência) |
| Conferência | A árvore resultante (`4214b04`) é **idêntica** à da branch que passou na E2E completa (67/67, 972/972) |
| Migrations e seed | **Nenhuma.** Salto, branch e DEV com 23 migrations; a correção não muda o banco |

Este relatório e as capturas entram num commit de documentação logo depois do merge.

## 2. Pré-verificação

| Item | Resultado |
| --- | --- |
| Branches | `correcao-fotos-produtos` 2 commits à frente; `salto-desenvolvimento` 0 à frente da branch |
| Alterações não commitadas | Nenhuma em arquivos versionados (principal e worktree das fotos) |
| Migrations pendentes | Nenhuma (23 = 23 = 23) |
| DEV | Banco sem mudanças desde a última conferência; API (4100) ligada desde 12/11 16:29; site (3100) desligado |
| FINAL | 4 containers saudáveis, no ar havia 36 h |
| Hooks do Git | Desligados (`core.hooksPath` vazio) |

## 3. Backups

Todos ficaram fora do repositório, em `C:\Users\rafae\Desktop\Projetos\restaurant-saas-backups\`.

| Tipo | Caminho / nome | Conferência |
| --- | --- | --- |
| Tag Git | `backup/salto-desenvolvimento-antes-fotos-20261113_015759` | → `2a1d6a5` |
| Tag Git | `backup/correcao-fotos-aprovada-20261113_015759` | → `18bffed` |
| Bundle do código | `codigo\restaurant-saas_antes_fotos_20261113_015759.bundle` | `git bundle verify` ok; SHA-256 `5918f16c48796de8340a347b851ad4b98273cbe59c821351f8c79eb474bd80ff` (arquivo `.sha256` ao lado) |
| Banco DEV completo | `dev\restaurant_saas_dev_20261113_015759_antes_integracao_fotos.dump` (15.915.230 bytes, `pg_dump -Fc`) | SHA-256 `e40fe0d1b3c5cedf3f05ca002c875fe032f5910aed191b93d3509c2a22dbf0a3`. **Restaurado** no banco descartável `rs_devcopy_fotos`: **64/64 tabelas idênticas** (29.368 linhas) |

**Para voltar atrás:**
- **Código:** `git reset --hard backup/salto-desenvolvimento-antes-fotos-20261113_015759` na
  `salto-desenvolvimento`, depois reconstruir a API e o web.
- **Banco:** não é necessário, porque a correção não grava nada.

## 4. Serviços atualizados

| Serviço | O que foi feito |
| --- | --- |
| API do DEV (4100) | `nest build` → a API antiga parou (PID 2732, conferido como `dist/src/main.js` da pasta principal) → subiu de novo com as mesmas variáveis de antes: `WHATSAPP_AI_PROVIDER=local`, `WHATSAPP_CLOUD_ENABLED=false`, `PUBLIC_WEB_URL=http://localhost:3100`, sem chave de IA e sem segredos da Meta |
| Site do DEV (3100) | `next build` com **`API_URL=http://127.0.0.1:4100/v1`** (conferido no `routes-manifest`: é o único destino do proxy) → `node server.js` na porta 3100 |
| Builds | Feitos um de cada vez (API e depois web), com cerca de 4,5 GB de RAM livre |
| Ambiente final | **Não foi tocado**: containers no ar sem reinício, site 3600 respondendo 200 |

## 5. Verificações

### 5.1 No DEV real (só leitura; o único registro gravado foi o login da conta de teste)

| Verificação | Resultado |
| --- | --- |
| Produtos da Do'cê | **78** preservados: **75 com foto** e **3 sem foto** ("Água com gás", "Água sem gás", "Suco latinha pêssego") |
| Fotos servidas | **75/75** respondendo pelo proxy do site (200, `image/jpeg`) |
| Cardápio público da Do'cê | Página renderiza com as fotos; nenhuma imagem quebrada |
| Preços e adicionais | Hash de preço, preço "de" e esgotado dos 78 produtos e hash de preço, máximo e esgotado dos 27 adicionais **idênticos** aos de antes do merge |
| Fallback (restaurante de validação) | `/products` traz `photoUrl` nulo para os produtos sem foto; o PDV mostra o ícone (5 cards) |
| Fichas técnicas | Respondem com o campo de foto resolvido; a página abre |
| PDV sem fiado | Continua só Dinheiro, Pix e Cartão |
| Isolamento | Nenhum produto ou foto da Do'cê aparece em outro restaurante |
| Console do navegador | Sem erros |

**Total no DEV real:** 7 verificações pela API e 5 no navegador, todas aprovadas.

**O que o login gravou e o que não mudou:**
- só `refresh_tokens`, `audit_logs` e a data de login em `users` (login da conta de teste);
- **nenhum pedido** foi registrado nas últimas horas;
- **nenhuma conexão de WhatsApp** foi criada.

### 5.2 Na cópia descartável do DEV (dados reais, código novo, operações que gravam)

**Ambiente:**
- banco `rs_devcopy_fotos`, restaurado do backup de agora há pouco;
- API e site da branch das fotos nas portas 4950 e 3950;
- senhas temporárias **só na cópia**: a sua senha no DEV não mudou, conferido pelo hash.

**Resultado: 13/13 verificações, sem erros no console.**

| Verificação | Resultado |
| --- | --- |
| **Fotos no PDV da Do'cê** | **75/75 carregadas**; os 3 sem foto mantêm o ícone |
| Preços e adicionais no PDV | Smash Clássico + Bacon = **R$ 34,00** no modal e no carrinho cotado pelo servidor |
| **Fotos nas fichas técnicas** | **75/75 miniaturas**; amostras servidas com 200 `image/jpeg` |
| **Fotos no carrinho do WhatsApp** | Simulador (ativado **só na cópia**) → resumo → "sim" → link → carrinho público com a **foto carregada**, R$ 34,00 e "+ Bacon" |
| Checkout | Mesmo total, sem fiado; pedido confirmado na cópia (id `b1b5d2d1-cd41-4213-b166-19fcf1cc0f0c`, PIX, R$ 34,00, com Bacon) |
| Cardápio público | Fotos como antes |
| Isolamento | O PDV do restaurante de validação não mostra nenhuma foto nem produto da Do'cê |

Capturas em `docs/capturas/integracao-fotos-dev/`:
- `dev-fotos-*`: no DEV real, só navegação;
- `copia-dev-fotos-*`: na cópia descartável.

## 6. Integridade do DEV e do FINAL

| Item | Estado |
| --- | --- |
| Banco DEV | Igual ao backup de antes da integração, exceto `refresh_tokens`, `audit_logs` e `users` (só o login de teste); 23 migrations; preços e adicionais idênticos; 78/75 fotos |
| Banco FINAL | **51/51 tabelas idênticas** |
| `restaurant-saas-final` | `e04d4a7`, sem alterações |
| Ambiente final | Containers sem reinício; site 3600 respondendo 200 |
| `master` / GitHub | `a23be9a` = `origin/master`; nenhum push, nenhum deploy |
| Cardápio da Do'cê | Não foi reimportado |
| Docker e WSL | Não foram reiniciados. `rs-adic-pg` e `rs-adic-redis` foram religados só para o teste de restauração e a cópia, e parados de novo no fim |
| Worktrees e containers | Nenhum removido |

## 7. Pendências

1. **Simulador do WhatsApp na Do'cê (DEV):** continua sem conexão. Para ver a foto no carrinho do
   WhatsApp no DEV, ative o simulador em Atendimento › WhatsApp com a sua conta (cria uma conexão
   **simulada** só para a Do'cê).
2. **Caixa da Do'cê fechado no DEV:** vendas em dinheiro no PDV pedem caixa aberto, como antes.
3. **Processos do DEV:** a API (4100) e o site (3100) foram iniciados por esta sessão e podem parar
   se o Claude Code fechar ou se faltar memória. Os comandos para religar estão na seção 8 do
   `RELATORIO_INTEGRACAO_DEV_FINAL.md`.
4. **Branch e worktree `correcao-fotos-produtos`:** integradas. Podem ser removidas numa próxima
   limpeza, com a sua aprovação.
5. **Itens antigos que continuam abertos:**
   - cartão de crédito × débito;
   - conexão real com a Meta, provedor de IA e LGPD;
   - o restante da limpeza do Docker: cache, compactação do disco virtual e `.wslconfig`.
