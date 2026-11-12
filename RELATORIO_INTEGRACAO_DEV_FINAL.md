# Relatório — Integração das três funcionalidades ao DEV

Data: 12/11/2026, das 15:45 às 16:40
Funcionalidades: adicionais no PDV e nas comandas, assistente de WhatsApp (só simulado) e remoção
das vendas fiadas novas.
Autorização: o roteiro "INTEGRAÇÃO APROVADA AO DEV" e a confirmação explícita, antes de escrever no
banco DEV, na pergunta "Aplicar no DEV".
Tudo é **local**: sem push, sem deploy, sem produção. A `master` continua em `a23be9a`, igual à do
GitHub.

## 1. Commit do merge

| | |
| --- | --- |
| Merge | **`9a1acd4`** — `Merge branch 'integracao-funcionalidades-2026-11' into salto-desenvolvimento` (`--no-ff`, histórico preservado) |
| Antes | `salto-desenvolvimento` em `c866ff5` (sem commits novos desde a integração temporária) |
| Origem | `integracao-funcionalidades-2026-11` em `db8a2a6`, com os commits de compatibilidade `2ae6e9e` e `d6ef2a8` |
| Conferência | A árvore resultante (`d5ce194…`) é **idêntica** à da branch de integração, a mesma em que a E2E completa passou |
| Divergências | Nenhuma: a `salto-desenvolvimento` era ancestral da branch de integração |

Este relatório e as capturas entram num commit de documentação logo depois do merge.

A worktree `restaurant-saas-integracao` tem uma alteração sua, não commitada, no
`RELATORIO_INTEGRACAO_FUNCIONALIDADES.md`: as tabelas foram realinhadas às 15:39. Ela foi mantida
como estava e não faz parte do merge.

## 2. Backups realizados

Todos ficaram **fora do repositório**, em `C:\Users\rafae\Desktop\Projetos\restaurant-saas-backups\`.

| Tipo | Caminho / nome | Conferência |
| --- | --- | --- |
| Tag Git | `backup/salto-desenvolvimento-antes-integracao-funcionalidades-20261112_154729` | → `c866ff5` |
| Tag Git | `backup/integracao-funcionalidades-aprovada-20261112_154729` | → `db8a2a6` |
| Bundle do código | `codigo\restaurant-saas_antes_integracao_funcionalidades_20261112_154729.bundle` (7,4 MB) | `git bundle verify`: ok. SHA-256 `2fed36c9a717514e0d136fcaaab09db4561664b4514063e882a915df252217b2` (arquivo `.sha256` ao lado). Contém 6 branches (salto, integração, as três originais, master) e as 2 tags |
| Banco DEV completo | `dev\restaurant_saas_dev_20261112_154729_antes_integracao_funcionalidades_migrations_22_23.dump` (15,9 MB, `pg_dump -Fc`) | SHA-256 `b79105e8679a99ef32c14aed210c953c103590b791c2dea635bfdedf2b6fca97` (arquivo `.sha256` ao lado) |

**Para voltar atrás, se for preciso:**
- **Código:** `git reset --hard backup/salto-desenvolvimento-antes-integracao-funcionalidades-20261112_154729` na `salto-desenvolvimento`.
- **Banco:** restaurar o dump acima no `restaurant_saas`.

## 3. Resultado da restauração

**Como foi testada:**
- o dump foi restaurado num banco descartável novo: `rs_devcopy_integ`, no container de teste
  `rs-adic-pg`, porta 55480;
- a cópia foi comparada com o DEV tabela por tabela, com um hash do conteúdo de cada linha.

**Resultado:**

| | |
| --- | --- |
| Tabelas | **56 de 56 idênticas** (29.337 linhas) |
| Esquema | Idêntico. A única diferença no `pg_dump --schema-only` é o token aleatório `\restrict` que o próprio `pg_dump` gera em cada execução |
| Gatilhos | Os 6 gatilhos do livro-razão financeiro, presentes |

Logo antes de aplicar as migrations, o DEV foi conferido de novo: **nada tinha mudado desde o
backup**.

## 4. Resultado das migrations 22 e 23

**O que cada migration faz:**

| Nº | Migration | O que faz |
| --- | --- | --- |
| 22 | `20261112120000_tab_item_options` | Cria só a tabela `tab_item_options` |
| 23 | `20261112200000_whatsapp_assistant` | Cria só 7 enums e 7 tabelas `whatsapp_*` |

As duas são **só aditivas**: nenhum `DROP`, `DELETE`, `UPDATE`, `TRUNCATE` ou `RENAME`, e nenhuma
altera tabela existente.

**Primeiro, na cópia restaurada do DEV:**
- `migrate deploy` (23/23) e seed;
- as **53 tabelas que não são do controle de migrations nem de permissões ficaram idênticas** em
  conteúdo, incluindo pedidos, contas a receber, pagamentos, lançamentos e auditoria;
- as 70 permissões e os 245 vínculos de papel antigos ficaram idênticos;
- as 8 tabelas novas foram criadas vazias;
- 156 chaves estrangeiras, todas validadas (`convalidated`), e os 6 gatilhos presentes;
- `prisma migrate status`: "Database schema is up to date";
- `prisma migrate diff` entre o banco e o `schema.prisma`: nenhuma diferença.

**Depois, no DEV** (`restaurant_saas`, `localhost:5432`, confirmado no `Datasource` antes de
aplicar):
- 1. A API antiga do DEV (porta 4100, iniciada em 11/11) foi parada.
- 2. `prisma migrate deploy` aplicou exatamente as 2 migrations pendentes: **23/23**.
- 3. O seed só cria ou atualiza (`upsert`) e nunca apaga.
- 4. O resultado foi **idêntico ao da cópia**:
  - as 53 tabelas de dados ficaram iguais, byte a byte;
  - as permissões e vínculos antigos ficaram iguais;
  - as 8 tabelas novas estão vazias;
  - sem drift;
  - nenhuma constraint ficou sem validação;
  - os 6 gatilhos estão presentes.
- Não foi usado `migrate reset` nem `db push`.

## 5. Permissões do WhatsApp

| Papel | Permissões novas |
| --- | --- |
| OWNER | `whatsapp.read`, `whatsapp.reply`, `whatsapp.configure` |
| ADMIN | `whatsapp.read`, `whatsapp.reply`, `whatsapp.configure` |
| MANAGER | `whatsapp.read`, `whatsapp.reply` |
| CASHIER | `whatsapp.read`, `whatsapp.reply` |
| KITCHEN, WAITER e demais | nenhuma |

**Totais no DEV:** 73 permissões (70 + 3) e 255 vínculos de papel (245 + 10).

**Conferido no DEV:**
- o dono acessa `GET /whatsapp/conversations` (200);
- uma conta de **cozinha** recebe 403 em `/whatsapp/conversations`, em `/whatsapp/settings` e em
  `/receivables`.

**Permissões são por papel; o acesso é por restaurante:** cada restaurante só vê os próprios dados
(seção 7).

**`receivables.sell` (vender fiado):** a linha continua no banco, com 4 vínculos de papel, mas
nenhuma rota a exige e nenhuma sessão a recebe. Removê-la é uma limpeza opcional, com backup.

## 6. Fiados antigos no DEV

| | |
| --- | --- |
| Clientes com fiado em aberto | **1** — "Val Bia Fiado", do restaurante de validação de 05/10 (`tenant-1790557114775-…`), que não é a Do'cê |
| Contas em aberto | **2**, somando **R$ 25,00** (R$ 15,00 + R$ 10,00) |
| Parcelas vencidas | **2**, vencidas em 04/11/2026, somando R$ 25,00 |
| Histórico total | 5 contas (2 abertas, 1 paga, 2 canceladas), 4 pedidos fiados, 15 lançamentos, 8 alocações de pagamento, 2 contas de crédito, 17 auditorias |
| Do'cê | **Nenhum fiado** |

- Nada foi apagado nem liquidado no DEV.
- Na cópia descartável, o recebimento de R$ 5,00 por PIX funcionou, e a conta caiu de R$ 15,00 para
  R$ 10,00.
- No DEV, essas contas continuam visíveis em "Contas a receber", com o aviso de que o sistema não
  vende mais fiado e sem "Lançar dívida".

## 7. Resultados dos testes

### 7.1 Código integrado, em bancos descartáveis

| Teste | Resultado |
| --- | --- |
| E2E completa (`rs_integ_full3`, banco novo, mesma árvore do merge) | **66/66 suítes, 970/970 testes**, numa única execução |
| Unitários da API (na worktree principal, depois do merge) | **49 suítes / 486 testes** |
| Unitários do web (na worktree principal) | **44 suítes / 455 testes** |
| Typecheck da API e do web | sem erros |
| Build de produção | API (`nest build`) e web (`next build` com `API_URL=http://127.0.0.1:4100/v1`) sem erros |

### 7.2 Na cópia descartável do DEV (dados reais, operações que gravam)

**Ambiente:**
- código integrado rodando sobre `rs_devcopy_integ`, com Redis próprio e portas 4950/3950;
- senhas temporárias **só na cópia** para a conta da Do'cê e para a conta de teste. A senha da sua
  conta no DEV não mudou: o hash de lá é diferente do da cópia.

**Navegador: 35 verificações aprovadas, sem erro no console.**

| Fluxo | Resultado |
| --- | --- |
| Cardápio público real da Do'cê | Fotos e combo com o refrigerante obrigatório |
| PDV | Grupo real "Turbine seu lanche!" (R$ 36,00); o combo não entra sem o refrigerante; carrinho de R$ 50,99 cotado pelo servidor; só Dinheiro/Pix/Cartão; venda em **dinheiro** e no **cartão** concluídas |
| Comanda na mesa 3 | Adicionais e observação na rodada; fechamento só com CASH/PIX/CARD; paga em PIX (R$ 52,99) |
| Cozinha | Mostra os adicionais do PDV e da mesa |
| Fiado antigo | Visível, com aviso, sem "Lançar dívida" e com o vencido destacado; o histórico mostra a venda como fiado |
| WhatsApp (simulador ativado só na cópia) | Responde que não trabalha com fiado; cardápio real com adicional (R$ 34,00); o combo pergunta o refrigerante; resumo, "sim" e link |
| Checkout pelo link | Pedido **#MWDWWBFK-FCEF** confirmado (ONLINE, PIX, R$ 48,99), gravado com os adicionais Bacon e Coca cola zero lata |
| Isolamento | Um restaurante não vê os dados do outro, nos dois sentidos |

**Observação:** a primeira tentativa de venda em dinheiro foi recusada com "Não há caixa aberto
nesta unidade". É o comportamento correto, porque a Do'cê não tem caixa aberto no DEV. Depois de
abrir o caixa na cópia, a venda passou.

**API: 10 verificações aprovadas.**
- A conta antiga recebe pagamento.
- A venda `ON_ACCOUNT` é recusada (400).
- As rotas de crédito antigas não existem mais (404).
- A comanda que estava **aberta no DEV desde antes dos adicionais** (mesa 1, Burger Bacon R$ 26,00)
  continua abrindo com o mesmo total.
- Um restaurante recebe 404 ao pedir dados do outro.

### 7.3 No DEV real, sem alterar dados

Foram feitas só leituras e navegação, mais o login da conta de teste do restaurante de validação.
O login gravou só 1 token de sessão, 1 auditoria de login e a data do último acesso; isso foi
conferido por hash antes e depois. Nenhum pedido, pagamento ou conexão de WhatsApp foi criado no
DEV.

| Verificação | Resultado |
| --- | --- |
| Login | OK |
| Cardápio público da Do'cê | API (78 produtos), página do web e proxy `/api` OK; fotos carregando; nada de fiado |
| Produtos e adicionais | Listas OK |
| PDV | Só Dinheiro, Pix e Cartão; nenhum texto de fiado |
| Comandas, cozinha e pedidos | Telas abrem; o histórico (12 pedidos, 4 fiados antigos) continua visível |
| Contas a receber antigas | 2 contas em aberto (R$ 25,00, vencidas), com aviso e sem "Lançar dívida" |
| WhatsApp | Painel abre; nenhuma conexão ligada |
| Permissões | Dono com acesso ao WhatsApp; cozinha com 403 |
| Isolamento | Comanda da Do'cê: 404 para outro restaurante; nenhum produto da Do'cê em outro restaurante |
| Console do navegador | Sem erros |

**Total:** 18 verificações pela API (incluindo 3 de permissão) e 10 no navegador, todas aprovadas.
As duas falhas da primeira execução eram erros do meu script: o formato da resposta de `/auth/me` e
um parâmetro inexistente em `/orders`. Refeitas do jeito certo, passaram.

## 8. URLs do DEV

| | |
| --- | --- |
| Site (painel) | http://localhost:3100 |
| Cardápio público da Do'cê | http://localhost:3100/menu/doce-hamburgueria |
| API | http://localhost:4100/v1 |
| Banco | `restaurant_saas` no container `restaurant-saas-postgres` (localhost:5432), 23 migrations |

**Configuração com que a API do DEV foi iniciada:**
- `PORT=4100`, `CORS_ORIGIN=http://localhost:3100`, `TRUST_PROXY_HOPS=1`,
  `PUBLIC_WEB_URL=http://localhost:3100`;
- **`WHATSAPP_AI_PROVIDER=local`** e **`WHATSAPP_CLOUD_ENABLED=false`**;
- sem `ANTHROPIC_API_KEY` e sem segredos da Meta.

**O que isso garante:** só o assistente local, sem custo; nenhum envio para fora; e o webhook
recusa qualquer entrega.

**Web:**
- build com `API_URL=http://127.0.0.1:4100/v1`, conferido no `routes-manifest`;
- `server.js` se recusa a subir se a `API_URL` for outra;
- assim, o web não conversa com a API de outro ambiente (homologação 4000, piloto 4500, demo
  4300, final 4600).

**Para religar** (os processos foram iniciados por esta sessão e podem parar se o Claude Code
fechar ou se faltar memória):

```
cd apps/api && env -u DATABASE_URL -u REDIS_URL -u JWT_ACCESS_SECRET -u JWT_REFRESH_SECRET PORT=4100 CORS_ORIGIN=http://localhost:3100 TRUST_PROXY_HOPS=1 PUBLIC_WEB_URL=http://localhost:3100 WHATSAPP_AI_PROVIDER=local WHATSAPP_CLOUD_ENABLED=false node dist/src/main.js
cd apps/web && PORT=3100 API_URL=http://127.0.0.1:4100/v1 NODE_ENV=production node server.js
```

**Para usar o simulador do WhatsApp na Do'cê:**
- entre com a sua conta em Atendimento › WhatsApp e ative o simulador;
- isso cria uma conexão **simulada** só para a Do'cê; nenhum número real é usado;
- não ativei o simulador no DEV, para não gravar nada em nome do restaurante.

## 9. Pendências restantes

1. **Simulador da Do'cê no DEV:** ativar pelo painel quando quiser testar (seção 8).
2. **Caixa da Do'cê fechado no DEV:** vendas em dinheiro no PDV pedem caixa aberto, como antes.
3. **Comanda aberta na mesa 1 da Do'cê** (desde 10/11, R$ 26,00): continua aberta e compatível.
4. **Fiado de teste** ("Val Bia Fiado", R$ 25,00, vencido): continua em aberto no restaurante de
   validação. Pode ser recebido ou cancelado pela tela, se quiser.
5. **Fotos dos produtos importados no PDV e no carrinho que vem do link do WhatsApp:** aparece o
   ícone padrão. Isso já acontecia antes desta integração.
6. **Cartão de crédito e débito:** continua uma única forma, "Cartão" (decisão sua).
7. **Limpeza opcional da permissão `receivables.sell`**, com backup.
8. **WhatsApp real:**
   - conexão com a Meta;
   - escolha e avaliação de um provedor de IA;
   - política de retenção das conversas (LGPD).
   Nada disso foi configurado.
9. **Push, deploy e `master`:** não autorizados. Um push na `master` publica em produção
   automaticamente.
10. **Bancos descartáveis** (container `rs-adic-pg`) que podem ser apagados quando quiser:
    - `rs_devcopy_integ`, `rs_integ_*`, `rs_adic_*`, `rs_whats_*`, `rs_fiado_*`;
    - nenhum deles é o DEV.
11. **Hooks do Git:** o `pnpm install` voltou a ligar o `core.hooksPath`, como nas outras vezes, e
    eu desliguei de novo.

## 10. Ambiente acadêmico e demais ambientes

| Ambiente | Estado |
| --- | --- |
| `restaurant-saas-final` (worktree) | Em `e04d4a7`, sem nenhuma alteração |
| Containers `restaurant-saas-final-*` (3600/4600) | Rodando há 26 h, não foram reiniciados |
| Banco `restaurant_saas_final` | Nenhuma conexão foi feita a ele |
| Apresentação, PowerPoint e material acadêmico | Não foram tocados |
| Homologação (`restaurant-saas-stack`, 3000/4000), piloto (3500/4500), demo (3300/4300) | Não foram tocados; containers no ar há 26 h |
| Worktree do piloto | Já tinha 70 alterações não commitadas de sessões anteriores; foram mantidas como estavam |
| `master` / GitHub / produção | `a23be9a`, igual ao `origin/master`; nenhum push, nenhum deploy |
| WhatsApp real / IA paga | Nenhuma conexão, nenhuma mensagem, nenhuma chamada |
| Cardápio da Do'cê | Não foi reimportado; 78 produtos, os mesmos de antes |
| Branches originais (`adicionais-pdv-comandas`, `assistente-whatsapp`, `remocao-fiado`) | Não foram alteradas |

Capturas de tela em `docs/capturas/integracao-dev-final/`:
- `dev-*`: no DEV, só navegação;
- `copia-dev-*`: na cópia descartável do DEV.
