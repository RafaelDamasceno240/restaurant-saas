# Relatório — Assistente de IA para WhatsApp (primeira versão)

Data: 12/11/2026
Branch: `assistente-whatsapp` (worktree `restaurant-saas-whatsapp`, criada a partir de
`salto-desenvolvimento` em `c866ff5`). Commits apenas locais: **sem push, sem deploy, sem
integração à `salto-desenvolvimento`, nenhuma conexão com a Meta**.

## 1. Resumo

O restaurante passa a ter um assistente de WhatsApp que conversa com o cliente usando o
**cardápio real do próprio restaurante**: categorias, produtos, preços, adicionais, disponibilidade,
horários e taxa de entrega. Ele monta o carrinho (com grupos obrigatórios, limites e observações),
apresenta o resumo e, **só depois de o cliente responder "sim"**, envia um link seguro que abre o
**checkout que já existe** com o carrinho preenchido. Nenhum pedido é registrado pelo WhatsApp: o
pedido só nasce quando o cliente confirma no checkout.

No painel (**Atendimento > WhatsApp**) a equipe vê as conversas, lê as mensagens, responde
manualmente, assume o atendimento da IA e devolve, configura saudação, comportamento e limite
diário, e liga ou desliga o assistente. Um **simulador** integrado permite testar tudo sem a Meta.

Tudo foi construído no formato da **WhatsApp Business Platform – Cloud API** oficial (webhook,
assinatura, payloads, status, janela de 24 h), mas nesta versão só existem **números simulados**:
nenhuma mensagem sai do servidor.

## 2. Arquitetura

```
Meta (futuro) ──POST /v1/whatsapp/webhook──┐
Simulador do painel ──(mesmo payload)──────┤
                                           ▼
             WhatsappIngestService: assinatura (X-Hub-Signature-256 sobre o corpo bruto),
             restaurante pelo phone_number_id, deduplicação (hash da entrega + wamid),
             ordem pelo timestamp, status que nunca regridem, opt-out
                                           │ (mesma transação)
                                           ▼
                    Fila whatsapp_jobs (PostgreSQL, FOR UPDATE SKIP LOCKED,
                    chave de deduplicação, novas tentativas com backoff)
                                           │
                                           ▼
     WhatsappReplyService: reserva por conversa (lease), transferência/opt-out/limites,
     histórico → AssistantEngine → resposta + carrinho + link + próximo job em UMA transação
     (inReplyToId UNIQUE: cada mensagem do cliente é respondida uma única vez)
                                           │
                     AssistantEngine ──────┼───── Provedores (registro configurável)
                     (proteções)           │       • local: regras, sem rede, sem custo (padrão)
                                           │       • anthropic: Claude via SDK oficial
                                           ▼
                     AssistantToolbox (ferramentas controladas, presas ao restaurante e ao cliente)
                       cardápio público · adicionais · horários · taxas · pedidos do próprio cliente
                       carrinho precificado por OrderCreationService.priceItems · resumo · link
                                           │
                                           ▼
                    WhatsappSendService → SimulatedSender (padrão) | CloudApiSender
                    (Cloud só com WHATSAPP_CLOUD_ENABLED=true e conexão CLOUD)
```

| Peça | Onde | O que faz |
|---|---|---|
| Webhook | `whatsapp-webhook.controller.ts`, `webhook/whatsapp-signature.ts` | GET de verificação (`hub.verify_token`), POST com HMAC-SHA256 do corpo bruto com o App Secret; público, sem limite por IP (a Meta entrega em rajadas) |
| Leitura do payload | `webhook/whatsapp-payload.ts` | Texto, botões e listas; outros tipos viram nota para a equipe; status `sent/delivered/read/failed` |
| Ingestão | `whatsapp-ingest.service.ts` | Contato, conversa, mensagem e job na mesma transação; duplicatas reconhecidas |
| Fila | `queue/whatsapp-queue.service.ts`, `queue/whatsapp-worker.service.ts` | Sem infraestrutura nova: linhas no Postgres, um job por vez, dentro do processo da API |
| Resposta | `whatsapp-reply.service.ts` | Transferência humana, opt-out, limites, chamada ao motor, gravação atômica |
| Motor e proteções | `assistant/assistant-engine.service.ts`, `assistant/assistant-guards.ts` | Provedor ativo com queda para o local, verificação de preços e links, saudação |
| Ferramentas | `assistant/assistant-toolbox.ts`, `assistant/catalog.ts` | O único jeito de a IA saber ou fazer algo |
| Provedores | `assistant/local-assistant.ts`, `assistant/anthropic-assistant.ts` | Regras (padrão) e Claude (configurável) |
| Envio | `sender/whatsapp-sender.ts`, `whatsapp-send.service.ts` | Simulado; Cloud API implementada mas desligada; token cifrado (AES-256-GCM) |
| Painel | `whatsapp-panel.service.ts`, `whatsapp-panel.controller.ts` | Configurações, conversas, resposta, assumir/devolver, simulador |
| Link de checkout | `whatsapp-checkout.service.ts` | Rota pública que lê o carrinho do token e o precifica de novo |

**Reaproveitado, sem duplicar regra de negócio:** o cardápio que a IA conhece é exatamente o
`PublicMenuService` (o mesmo de `/menu/<slug>`), e todo preço vem de
`OrderCreationService.priceItems` com grupos obrigatórios exigidos (a mesma regra do checkout).
A auditoria usa o `AuditService` existente; RBAC, multi-tenant e validação seguem os padrões do
projeto. Nenhuma tabela existente foi alterada.

### Migration 22 — `20261112200000_whatsapp_assistant`

Somente aditiva: 7 enums e 7 tabelas novas (`whatsapp_connections`, `whatsapp_contacts`,
`whatsapp_conversations`, `whatsapp_messages`, `whatsapp_webhook_events`, `whatsapp_jobs`,
`whatsapp_checkout_links`), índices, chaves estrangeiras e CHECKs (limite diário 0–10.000,
contadores e tokens não negativos, corpo da mensagem ≤ 4.096). Aplicada **apenas** em bancos
descartáveis (`rs_whats`, `rs_whats_e2e`, `rs_whats_full`, `rs_whats_shadow` no container
`rs-adic-pg`); `prisma migrate diff` sem diferença. **Não aplicada no DEV.**

Observação: a branch `adicionais-pdv-comandas` também tem uma "migration 22"
(`20261112120000_tab_item_options`). Os carimbos de tempo são diferentes e a ordem é coerente
(adicionais antes do WhatsApp); se as duas forem integradas, o DEV passa a 23 migrations.

### Permissões (novas)

| Permissão | Dono / Admin | Gerente | Caixa | Garçom, Cozinha, Entrega, Visualizador |
|---|---|---|---|---|
| `whatsapp.read` (ver conversas e configurações) | sim | sim | sim | não |
| `whatsapp.reply` (responder, assumir, devolver) | sim | sim | sim | não |
| `whatsapp.configure` (ligar/desligar, saudação, limites, simulador) | sim | não | não | não |

Entram pelo seed (idempotente), como as demais; a cópia do web (`lib/permissions.ts`) foi
atualizada e o teste que compara as duas passou.

## 3. Funcionalidades

**Conversa com o cliente (assistente local, padrão):**
- saudação configurável na primeira resposta;
- "cardápio", nome de categoria, "quanto custa o X", "horário", "taxa de entrega";
- pedidos em linguagem natural: `quero 2 smash com bacon extra sem cebola e 1 suco de laranja`
  (quantidades em número ou por extenso, adicionais pelo nome, observação "sem ...", vários itens);
- grupo obrigatório: pergunta com as opções numeradas e aceita o nome ou o número;
- adicional esgotado nunca entra; produto esgotado é recusado; limites do adicional e do grupo
  vêm do servidor;
- "carrinho", "remover 1", "limpar carrinho", "fechar" (resumo) → "sim" (link) ou "não" (continua);
- "status do pedido" / "pedido #1234": só pedidos feitos com o **mesmo número** de WhatsApp, no
  **mesmo restaurante**, nos últimos 60 dias;
- "atendente" (e variações) → transfere para a equipe; "parar" → opt-out.

**Link de checkout:** token aleatório de 256 bits, só o SHA-256 é guardado, válido por 2 horas,
amarrado ao restaurante (o slug errado dá 404, o expirado dá 410). Ao abrir, a página
`/menu/<slug>/whatsapp/<token>` mostra o carrinho **precificado agora** (um preço que mudou aparece
atualizado; um produto que esgotou fica de fora, com aviso) e o botão "Revisar e finalizar"
coloca o carrinho no carrinho público e leva ao fluxo normal. O pedido só é criado quando o
cliente confirma no checkout.

**Painel Atendimento > WhatsApp:**
- **Conversas:** lista com filtros (todas / assistente / equipe), não lidas, última mensagem;
  conversa com autor (cliente, assistente, atendente pelo nome, sistema), horário e status de
  entrega (fila, enviada, entregue, lida, não enviada com motivo); "Assumir atendimento",
  "Devolver ao assistente"; resposta manual (Ctrl+Enter), que assume a conversa; janela de 24 h e
  opt-out explicados no lugar do campo de resposta; atualização automática.
- **Simulador:** clientes fictícios, mensagens prontas e visual de celular; cada mensagem passa pelo
  mesmo caminho de uma mensagem da Meta. Só funciona com número simulado.
- **Configurações:** assistente ligado/desligado, saudação, comportamento (tom; não muda preço nem
  regra), limite diário de respostas, dados da conexão, provedor de IA e uso do dia (respostas e
  tokens).
- Funciona no celular (lista e conversa em telas separadas) e no computador (duas colunas).

**Preparado para o futuro (não ativado):** envio pela Cloud API (`CloudApiSender`, com testes de
transporte falso), tokens cifrados em repouso, registro de provedores para trocar ou somar
modelos, e o formato da toolbox permite acrescentar uma ferramenta "confirmar pedido no WhatsApp"
sem mudar o resto (hoje deliberadamente inexistente).

## 4. Inteligência artificial e segurança

- **Provedor configurável:** `WHATSAPP_AI_PROVIDER=local` (padrão, sem custo, sem rede) ou
  `anthropic` (Claude pelo SDK oficial `@anthropic-ai/sdk`, modelo `WHATSAPP_AI_MODEL`, padrão
  `claude-opus-5-5`, esforço `low`, `max_tokens` 2.048, fallback de recusa do lado do servidor
  ligado nos modelos que aceitam). A chave fica em `ANTHROPIC_API_KEY`, lida pelo próprio SDK.
  **O provedor Claude não foi chamado de verdade nesta etapa** (sem chave e sem enviar dados para
  fora); foi testado com um cliente falso. O laço de ferramentas é manual, com no máximo 6
  chamadas ao modelo por mensagem do cliente.
- **Não inventa informação comercial:** a IA só conhece o que as ferramentas devolvem. Antes de
  enviar, toda resposta de um modelo passa por uma verificação: um valor "R$ ..." que nenhuma
  ferramenta devolveu naquele turno é **bloqueado** e trocado por um texto seguro (o resumo do
  carrinho ou uma mensagem neutra), com registro na auditoria. Links que não sejam do próprio web
  são removidos.
- **Sem SQL livre, sem outros restaurantes:** nenhuma ferramenta recebe restaurante, telefone ou
  preço como parâmetro; o restaurante vem do `phone_number_id` da entrega e o cliente do `wa_id`.
  Ferramenta desconhecida é recusada.
- **Prompt injection:** além das instruções do sistema (mensagens do cliente são dados, não ordens),
  as regras que importam são **determinísticas e fora do modelo**: preço verificado, link só do
  sistema, link de checkout só depois do resumo e de um "sim" curto e inequívoco do cliente para
  **aquela versão** do carrinho, "atendente" e "parar" tratados antes do modelo, orientações do
  restaurante cercadas e incapazes de mudar as regras.
- **Controle de custo e de mensagens:** limite diário por restaurante (configurável; ao atingir, a
  conversa passa para a equipe), 30 respostas por conversa por hora, até 8 mensagens por turno
  (uma resposta para várias mensagens seguidas), mensagem de entrada limitada a 1.000 caracteres,
  6 chamadas ao modelo por turno, uso de tokens gravado em cada resposta e exibido no painel.
- **Falhas de provedor:** se o modelo falhar (rede, limite, erro), o assistente local responde
  naquele turno a partir do estado original; se tudo falhar, o job é tentado de novo com backoff e,
  na última tentativa, o cliente é avisado e a conversa vai para a equipe (nunca silêncio, nunca
  resposta duplicada).
- **Meta e LGPD:** respostas livres só dentro da janela de 24 h; opt-out respeitado; nenhum disparo
  em massa (só existem respostas a mensagens recebidas); o webhook não guarda o payload, só o hash;
  as respostas da API não expõem tokens nem segredos; os erros do provedor são gravados sem o texto
  que poderia conter token ou número.
- **Sem fiado:** o assistente não tem ferramenta de pagamento; o link leva ao checkout público, que
  só aceita dinheiro, PIX ou cartão. Desde 12/11 há também uma regra fixa no provedor de IA ("nunca
  ofereça fiado, venda a prazo ou pagar depois") e, no assistente local, uma resposta própria para
  perguntas sobre fiado e formas de pagamento ("O pagamento é feito na hora, no checkout: dinheiro,
  PIX ou cartão. Não trabalhamos com fiado..."), com teste. A remoção do fiado do sistema em si está
  na branch separada `remocao-fiado`.

## 5. Telas (capturas)

Em `docs/capturas/assistente-whatsapp/` (restaurantes fictícios "Burger Lab Teste" e
"Pizzaria Forno Teste", banco descartável):

| Arquivo | Conteúdo |
|---|---|
| `wa-01-painel` | Menu "Atendimento > WhatsApp", conversas vazias |
| `wa-02-simulador` | Simulador com clientes fictícios e mensagens prontas |
| `wa-03-escolha-obrigatoria` | Saudação e pergunta do grupo obrigatório "Ponto da carne" |
| `wa-04-carrinho` | Carrinho com adicionais, observação e subtotal do servidor |
| `wa-05-link-checkout` | Resumo, "sim" e link de checkout |
| `wa-06-atendente-responde` | Conversa transferida; atendente responde pelo nome |
| `wa-07-conversa-pedido` | Conversa do pedido com o selo "2 itens no carrinho" |
| `wa-08-configuracoes` | Configurações, conexão simulada e uso do dia |
| `wa-09-link-celular` | Página do link no celular (390×844) |
| `wa-10-carrinho-publico` | Carrinho público preenchido pelo link |
| `wa-11-painel-celular`, `wa-12-conversa-celular` | Painel no celular |
| `wa-13-pizzaria` | Outro restaurante: só o seu cardápio, nenhuma conversa do primeiro |
| `wa-14-simulador-transferencia` | Transferência para a equipe vista no simulador |

**Revisão visual organizada:** `docs/capturas/assistente-whatsapp/REVISAO_VISUAL.html` (abre no
navegador, sem servidor) agrupa as 14 capturas em: central de atendimento, conversas, respostas
automáticas, consulta ao cardápio, carrinho, confirmação do checkout, atendimento humano,
configurações e interface mobile, com legendas e as observações das capturas anteriores aos ajustes.

## 6. Testes

| Suíte | Resultado |
|---|---|
| API unitários | **48 suítes / 479 testes — todos passaram** (31 do WhatsApp, incluindo a regra contra fiado) |
| Web unitários | **43 suítes / 448 testes — todos passaram** (4 novos + menu atualizado) |
| Lint e typecheck API e web; `nest build`; `next build` | sem erros |
| E2E novo `whatsapp.e2e-spec.ts` | **17/17** |
| E2E completa (banco novo `rs_whats_full`, 22 migrations, um processo, 464 s) | 62 de 65 suítes, 958 de 969 testes aprovados. As 11 falhas eram só das três suítes de linha de comando, que não conseguiram iniciar o processo filho por falta de memória (0xC0000142) |
| **As três suítes de CLI, repetidas individualmente** (mesmo banco, 12/11) | **`provision-tenant-cli` 11/11, `platform-admin-cli` 2/2, `reset-password-cli` 2/2 — todos passaram** |
| **Resultado consolidado** | **65 de 65 suítes e 969 de 969 testes aprovados**, em duas execuções: 62 suítes na completa e as 3 de CLI depois, isoladas |
| Revisão no navegador (Chrome headless, ambiente descartável 3900/4900) | 1ª passada 14/16, ajustes feitos; 2ª passada sem erros de console (detalhes abaixo) |

**Sobre a E2E completa e a memória.** Durante a execução, o Claude Code encerrou o monitor de
memória e a camada de shell por falta de memória na máquina (16 GB, com aplicativos abertos e cerca
de 23 containers de outros ambientes); o processo do Jest continuou e terminou sozinho, e nada foi
reiniciado. O pico de heap do Jest foi 1.631 MB. As três suítes de CLI abrem um segundo Node.js
por teste, e foi esse processo que o Windows não conseguiu criar. É o mesmo comportamento já
registrado na etapa dos adicionais, onde as mesmas suítes passaram ao repetir com memória livre.
Nenhum arquivo de CLI foi alterado nesta branch. Conferência feita depois, com 4,4 GB livres: a
CLI `tenant:provision` iniciou normalmente contra o banco descartável, fez as perguntas e recusou a
entrada incompleta sem criar nada ("Faltou: Razão social... Nada foi criado.", saída 2, a saída
de validação esperada). **Repetição (12/11):** com 4,3 GB livres e nada mais rodando, as três
suítes foram executadas uma por vez no mesmo banco descartável e passaram (15 de 15 testes). Assim,
todas as 65 suítes têm aprovação registrada, ainda que não numa única execução: a completa (62) e
as de CLI isoladas (3). A regra contra fiado (seção 4) foi acrescentada depois e verificada com os
testes unitários do WhatsApp (31/31) e o E2E do WhatsApp (17/17).

**Cobertura pedida → testes:**

| Pedido | Onde |
|---|---|
| Isolamento multi-tenant | E2E: conversas de outro restaurante dão 404 em ler, responder, assumir, devolver, marcar lida; cada assistente só responde com o próprio cardápio (pedido de produto do outro não entra); cliente com o slug errado dá 404 no link |
| Webhooks duplicados | E2E: mesma entrega 2×, mesma mensagem em outra entrega, 3 entregas simultâneas → 1 mensagem e 1 resposta |
| Mensagens fora de ordem | E2E: a segunda chega antes da primeira e o fio fica na ordem certa; status `read` antes de `delivered` e `failed` tardio não regridem |
| Falhas de provedores | E2E: provedor que falha → assistente local responde; tudo falhando → nova tentativa e, no fim, aviso + equipe. Unitário: Cloud API 429/5xx/rede = nova tentativa, 4xx = falha final sem vazar texto do provedor |
| Transferência para humano | E2E: "atendente" → equipe, assistente quieto, assumir, responder, devolver, assistente volta |
| Prevenção de respostas duplicadas | E2E: 3 processamentos simultâneos do mesmo job e reexecução do job → 1 resposta |
| Preços e adicionais | Unitário e E2E: grupo obrigatório, limite do adicional, adicional e produto esgotados, preço recalculado ao abrir o link, nenhum preço vindo do modelo |
| Confirmação do carrinho | Unitário e E2E: sem resumo não há link; "quero" não confirma; carrinho mudado exige novo resumo; nenhum pedido criado |
| Permissões | E2E: caixa lê e responde, não configura nem simula; gerente lê, não configura; garçom e cozinha 403; sem login 401 |
| Outros | assinatura inválida/ausente/sobre outros bytes = 401; número desconhecido ignorado; assistente desligado deixa as mensagens para a equipe; conexão CLOUD com envio desligado nunca envia; opt-out e janela de 24 h; validação dos campos |

**Revisão no navegador:** login como dono, simulador com pedido completo (adicionais, grupo
obrigatório, observação, resumo, "sim", link), transferência, resposta manual, devolução,
configurações, link aberto no celular levando ao carrinho público, painel no celular e o segundo
restaurante isolado. Ajustes feitos depois da 1ª passada: descrição visível no interruptor do
assistente, cabeçalho da conversa no celular, quebra de links longos nas mensagens e contadores
das abas atualizados quando uma conversa muda de mãos. Os erros de console da 1ª passada eram
pré-carregamentos do Next interrompidos pelas navegações forçadas do roteiro; na 2ª passada,
aguardando a página assentar, não houve nenhum. Conferido no banco: 0 pedidos criados.

## 7. Requisitos para conectar a Meta (depois da aprovação)

1. Conta empresarial da Meta (Business Manager) verificada e uma WhatsApp Business Account (WABA).
2. Um número de telefone exclusivo para a API (não pode estar em uso no app WhatsApp comum, ou
   precisa ser migrado), com nome de exibição aprovado.
3. Um app na Meta for Developers com o produto WhatsApp; **App Secret** (→ `WHATSAPP_APP_SECRET`).
4. Um usuário do sistema com token permanente e as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management` (→ guardado cifrado com `WHATSAPP_TOKEN_ENCRYPTION_KEY`).
5. Webhook público em HTTPS: `https://<api>/v1/whatsapp/webhook`, com `WHATSAPP_VERIFY_TOKEN`,
   assinado no campo **messages**.
6. Falta construir (próxima etapa, pequena): o cadastro da conexão CLOUD de cada restaurante
   (phone_number_id, WABA, token) por um fluxo administrativo, e então `WHATSAPP_CLOUD_ENABLED=true`.
   Começar pelo número de teste que a Meta fornece.
7. Políticas: política de privacidade publicada, opt-in do cliente, aviso de que é um assistente
   automático, política comercial da Meta, limites de envio por nível da conta, e modelos
   aprovados para qualquer mensagem fora da janela de 24 h (não implementados).
8. LGPD: definir retenção das conversas, base legal, e registrar a Meta e o provedor de IA como
   operadores no contrato/política.

## 8. Custos estimados

| Item | Estimativa |
|---|---|
| Infraestrutura | **R$ 0 adicional**: fila no PostgreSQL existente, worker dentro da API |
| Assistente local (padrão) | **R$ 0** por mensagem |
| Claude Opus 5.5 (US$ 4 / US$ 20 por milhão de tokens de entrada/saída) | ~10 mil tokens de entrada e ~800 de saída por mensagem do cliente com 2–3 chamadas de ferramenta ≈ **US$ 0,03–0,06 por mensagem** (menos com cache do prompt) |
| Claude Sonnet 5.5 (US$ 2 / US$ 10) | ≈ **US$ 0,015–0,03 por mensagem** |
| Claude Haiku 5.5 (US$ 0,10 / US$ 0,50) | ≈ **US$ 0,001–0,002 por mensagem** |
| Exemplo | 300 respostas/dia com Opus 5.5 ≈ US$ 9–18/dia; com Haiku 5.5 ≈ US$ 0,30–0,60/dia |
| WhatsApp (Meta) | Respostas a mensagens do cliente dentro da janela de 24 h não são cobradas na tabela vigente da Meta; modelos de marketing e alguns de utilidade fora da janela são cobrados por mensagem. **Conferir a tabela da Meta antes de ativar.** |

As estimativas de IA são aproximações a partir do tamanho do prompt e das ferramentas; os números
reais aparecem no painel (tokens do dia) assim que um provedor for ligado. O limite diário é o
teto de custo.

## 9. Riscos e limitações

- O assistente local entende frases comuns de pedido, mas não erros de digitação fortes, sinônimos
  que não estão no cardápio ou frases muito longas; quando não entende, diz o que sabe fazer.
- O provedor Claude **não foi avaliado com a API real** (custo, latência e qualidade precisam de
  uma rodada de testes aprovada antes de produção).
- A verificação de preços reconhece valores escritos com "R$" ou "reais"; um valor por extenso
  ("vinte e seis reais") não seria detectado.
- Só mensagens de texto (botões e listas incluídos); áudio, imagem e localização viram nota para a
  equipe.
- Sem modelos (templates), não há mensagem fora da janela de 24 h nem aviso proativo de status do
  pedido.
- O pedido criado pelo checkout não é ligado de volta à conversa (o link não carrega identificação).
- O horário de funcionamento é informado, mas quem bloqueia pedido fora do horário é o checkout.
- As conversas ficam guardadas sem prazo: falta a política de retenção (LGPD).
- O worker roda dentro da API: correto com várias instâncias (`SKIP LOCKED` e reserva por
  conversa), mas cada instância consulta a fila a cada segundo.

## 10. Como testar localmente

1. Banco e Redis descartáveis (nunca o DEV), por exemplo:
   `docker run -d --name rs-teste-pg -e POSTGRES_USER=saas -e POSTGRES_PASSWORD=saas -e POSTGRES_DB=rs_teste -p 127.0.0.1:55490:5432 postgres:16-alpine`
   e um Redis em outra porta.
2. Em `restaurant-saas-whatsapp/apps/api`, com `DATABASE_URL`/`REDIS_URL` desse banco e
   `WHATSAPP_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` fictícios (16+ caracteres):
   `npx prisma migrate deploy`, `npx ts-node prisma/seed.ts`, `npx nest build`.
3. Testes: `npx jest` (unitários), `npx jest --config ./test/jest-e2e.json test/whatsapp.e2e-spec.ts`
   (E2E do WhatsApp) ou a suíte completa com `--runInBand`.
4. Navegador: criar um restaurante com `pnpm tenant:provision` contra o banco descartável e
   cadastrar produtos e adicionais no painel; subir a API (`NODE_ENV=development PORT=4900
   PUBLIC_WEB_URL=http://127.0.0.1:3900 node dist/src/main.js`) e o web
   (`API_URL=http://127.0.0.1:4900/v1 npx next build` e `npx next start -p 3900`).
5. Em **Atendimento > WhatsApp**: "Criar número simulado" → **Configurações**: ligar o assistente
   → **Simulador**: conversar como cliente (ex.: "cardápio", "quero 2 X sem cebola", "fechar",
   "sim") → abrir o link → "Revisar e finalizar". Em **Conversas**: assumir, responder, devolver.
6. Para testar o Claude (opcional, com custo): `WHATSAPP_AI_PROVIDER=anthropic` e
   `ANTHROPIC_API_KEY` no ambiente da API.

## 11. Segurança dos ambientes

Não foram tocados: `restaurant-saas-final`, a apresentação acadêmica, `master`, produção, DEV
(nenhuma conexão), a branch `adicionais-pdv-comandas`, o cardápio da Do'cê (nada importado). Nenhum
push, nenhum deploy, nenhum número real, nenhuma mensagem enviada, nenhum pedido ou pagamento
real. Tudo rodou em bancos novos e descartáveis no container `rs-adic-pg` (55480) e no Redis
`rs-adic-redis` (56480, bases 5 a 7), com credenciais da Meta fictícias. Servidores pesados e a
suíte E2E nunca rodaram ao mesmo tempo; API, web e Chrome descartáveis foram encerrados antes da
E2E completa.

## 12. Pendências (decisões suas)

0. ~~Repetir as três suítes de CLI da E2E~~ — feito em 12/11: 15/15 testes (seção 6).
1. Aprovar a integração desta branch à `salto-desenvolvimento`.
2. Migration 22 do WhatsApp no DEV (com backup antes, como as anteriores).
3. Conexão real com a Meta (seção 7) e o fluxo de cadastro da conexão CLOUD.
4. Escolher e avaliar um provedor de IA real (ou manter o assistente local) e o limite diário.
5. Política de retenção das conversas (LGPD) e texto de aviso ao cliente.
6. Próximos passos sugeridos: modelos aprovados (aviso de status do pedido), ligar o pedido do
   checkout à conversa, finalizar o pedido dentro do WhatsApp (a arquitetura já comporta uma
   ferramenta de confirmação com as mesmas proteções).
