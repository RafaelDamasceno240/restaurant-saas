# Perfil do restaurante

O dono (ou um administrador) cadastra nome, descrição, contato, endereço e horário de funcionamento do restaurante em `/dashboard/restaurante`. O cardápio público (`/menu/<slug>`) mostra a parte pública desses dados, com "Aberto agora" ou "Fechado agora" calculado no fuso do restaurante. Até 2026-10-17 a página era só de apresentação, com endereço e horários demonstrativos e um formulário que não salvava.

## Onde cada dado fica

| Dado | Coluna | Aparece no cardápio |
|---|---|---|
| Nome | `tenants.name` | Sim (já aparecia) |
| Razão social | `tenants.legalName` | Não |
| Documento (CPF/CNPJ) e slug | `tenants.document`, `tenants.slug` | Não editáveis: identificam o restaurante e ficam como no cadastro |
| Descrição (até 500) | `tenants.description` | Sim |
| Instagram (sem "@") | `tenants.instagram` | Sim, como link |
| Telefone, WhatsApp (só dígitos) | `branches.phone`, `branches.whatsapp` | Sim; telefone como `tel:`, WhatsApp como `wa.me` (com 55 para números de 10 ou 11 dígitos) |
| E-mail | `branches.email` | Não (contato interno) |
| Endereço (rua, número, complemento, bairro, cidade, UF, CEP) | `branches.address` ... `branches.zipCode` | Sim, com link "Ver no mapa" |
| Horário de funcionamento | `branches.openingHours` (JSONB) | Sim, a semana inteira, mais "Aberto/Fechado agora" |

Contato, endereço e horários são da **unidade que recebe os pedidos online**: a primeira unidade ativa (`BranchAccessService.getDefaultBranchId`), a mesma que define a taxa de entrega. Com uma unidade por restaurante (o caso de hoje), é a matriz. Migration `20261017150000_restaurant_profile` (só acrescenta colunas nulas).

## Horários

- Formato: lista de intervalos `{ weekday, opens, closes }`, com `weekday` 0 = domingo ... 6 = sábado e horas `HH:MM` no fuso do restaurante (`tenants.timezone`, padrão `America/Sao_Paulo`).
- Fechamento antes da abertura significa depois da meia-noite: sexta `18:00`–`02:00` mantém o restaurante aberto até as 2h de sábado. Abertura igual ao fechamento é recusada.
- Até 3 turnos por dia (almoço e jantar cabem). Turnos sobrepostos são recusados, inclusive um que passa da meia-noite sobre o dia seguinte e sábado à noite sobre domingo.
- Dia sem intervalo é fechado. `[]` = fechado todos os dias. `null` = não informado: o cardápio não mostra horários nem "aberto agora".
- "Aberto agora" é calculado pela API no fuso do restaurante, nunca pelo relógio do navegador: abertura inclusiva, fechamento exclusivo.
- **Desde 2026-10-23 (correção B1 do piloto), o cardápio online não aceita pedido com o restaurante fechado.** `POST /v1/public/orders` responde `409 RESTAURANT_CLOSED` ("O restaurante está fechado agora e não está recebendo pedidos...") pela mesma regra do "Aberto agora" (`acceptsOrdersAt` em `opening-hours.ts`, no fuso do restaurante, inclusive intervalos que passam da meia-noite). Horário não informado (`null`) não restringe. Um reenvio de pedido já aceito (mesma chave de idempotência) continua sendo respondido. O checkout mostra o aviso no topo e desabilita "Confirmar pedido". PDV e mesas são fluxos da equipe e continuam funcionando fora do horário publicado.
- As regras estão em `apps/api/src/modules/tenants/opening-hours.ts` (testadas em `opening-hours.spec.ts`). Um valor gravado fora da regra (por exemplo, editado à mão no banco) é lido como "não informado" em vez de quebrar o cardápio.

## API

| Rota | Permissão | O que faz |
|---|---|---|
| `GET /v1/tenants/current/profile` | `restaurant.read` (OWNER, ADMIN, MANAGER, VIEWER) | Perfil do restaurante do usuário autenticado, com a unidade e `openNow` |
| `PATCH /v1/tenants/current/profile` | `restaurant.update` (OWNER, ADMIN) | Altera só os campos enviados |
| `GET /v1/public/menu/:slug` | pública | `restaurant` passa a trazer `description`, `phone`, `whatsapp`, `instagram`, `address` (ou `null`), `openingHours` e `openNow`. Nunca e-mail, razão social, documento ou ids |

Regras do `PATCH`:

- Nome e razão social podem mudar, mas não ficar vazios. Os demais campos aceitam `null` ou texto em branco para limpar.
- Normalização: telefone e WhatsApp em dígitos (mesma regra do CRM: `+55` é removido), e-mail em minúsculas, Instagram sem "@", UF em maiúsculas e só as 27 válidas, CEP em 8 dígitos, horários ordenados.
- Campo desconhecido, `document`, `slug`, `timezone` ou `tenantId` no corpo: `400`.
- A linha do tenant é travada (`FOR UPDATE`): dois editores ao mesmo tempo são aplicados um depois do outro.
- Enviar o que já está gravado não grava nada nem audita. Uma alteração grava `RESTAURANT_PROFILE_UPDATED` no `AuditLog`, na mesma transação, com antes e depois só dos campos alterados e o id da unidade.
- O nome novo aparece em `/auth/me` imediatamente; a tela atualiza o nome do menu lateral depois de salvar.

## Telas

| Rota | Modo | Fonte dos dados |
|---|---|---|
| `/dashboard/restaurante` | Real (OWNER, ADMIN e MANAGER no menu; edição só para OWNER e ADMIN) | `GET /tenants/current/profile` + `GET /orders` para as métricas do dia |
| `/demo/restaurante` | Demonstração (sem login, sem chamadas à API) | `apps/web/lib/demo/restaurant-profile.ts` |
| `/menu/<slug>` | Público | `GET /public/menu/:slug` |

- No modo real nada é demonstrativo: o que não foi informado aparece como "Não informado" (ou "Nenhuma descrição informada"), sem o selo "Dados demonstrativos". Os cards de Operação e os rótulos das métricas continuam vindo do perfil de demonstração, porque não são dados do perfil.
- "Editar perfil" abre `components/restaurante/RestaurantProfileFormDialog.tsx`: restaurante, contato, endereço e horários (um interruptor "Informar horários no cardápio" e, por dia, aberto/fechado com até 3 turnos). Valida antes de enviar (`lib/restaurant-profile-logic.ts`), envia só o que mudou em relação ao perfil do momento em que o diálogo abriu (um refetch em segundo plano não apaga o que está sendo digitado nem desfaz a alteração de outra pessoa) e mostra a mensagem da API quando ela recusa, como em turnos sobrepostos.
- Para MANAGER e VIEWER a página é só leitura (sem o botão).
- No cardápio público, `components/menu/RestaurantInfo.tsx` (componente de servidor, sem JavaScript no navegador) mostra descrição, "Aberto/Fechado agora", endereço com "Ver no mapa", botões de WhatsApp, telefone e Instagram e a semana em um bloco expansível. Um restaurante que nunca preencheu o perfil continua mostrando só o nome.
- O modo demonstração não mudou: "Aplicar na apresentação" altera só o estado da página.

## Limitações

- A logo do cabeçalho do perfil é a do Do'cê para qualquer restaurante (não existe envio de logo). Anterior a esta entrega.
- Restaurantes com mais de uma unidade: só a unidade que recebe os pedidos online é editada aqui.
- Sem feriados, exceções de data nem "fechado temporariamente".
- O fuso (`tenants.timezone`) não é editável pela tela.
