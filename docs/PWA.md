# PWA e experiência mobile

Estado real implementado em 2026-10-05. O painel do restaurante (`/dashboard`) pode ser **instalado** no celular, no tablet ou no computador e foi ajustado para uso com o dedo. O cardápio público continua sendo um site comum.

## O que existe

| Peça | Onde | Papel |
|---|---|---|
| Manifest | `apps/web/app/manifest.ts` → `/manifest.webmanifest` | nome, ícones, `start_url: /dashboard`, `display: standalone`, atalhos (PDV, Pedidos, Cozinha, Delivery) |
| Ícones | `apps/web/public/icons/` e `apps/web/app/favicon.ico` | 192, 512, 512 maskable, 180 (Apple), SVG e favicon |
| Service worker | `apps/web/public/sw.js` | página offline, cache dos arquivos de build, clique em notificação |
| Página offline | `apps/web/public/offline.html` | estática, sem script |
| Registro | `components/pwa/ServiceWorkerRegistration.tsx` | só em build de produção, origem segura |
| Instalar | `components/pwa/PwaControls.tsx` + `lib/install-prompt.ts` | botão "Instalar app" na barra superior |
| Sem conexão | `OfflineBanner` + `lib/use-online-status.ts` | faixa de aviso no painel |
| Avisos de pedido | `lib/use-order-alerts.ts` + `OrderAlertsButton` | notificação local de pedido novo |
| Regras puras | `lib/pwa.ts` | decisões testáveis sem navegador |

## Service worker: conservador de propósito

O painel mostra dinheiro, pedidos e dados de clientes atrás de uma sessão. Por isso o worker **nunca guarda**:

- nada em `/api` (toda resposta depende de quem pergunta e de quando);
- páginas HTML (carregam o nonce da CSP da requisição e refletem a sessão);
- dados de navegação do Next (`?_rsc=`, `/_next/data`), imagens do cardápio, nada de outra origem;
- escritas (`POST`, `PUT`, `PATCH`, `DELETE`): vão sempre à rede e **falham** sem conexão. Não existe fila offline: uma venda nunca parece concluída sem ter sido.

Ele guarda apenas:

- `/_next/static/*` (arquivos do build, imutáveis, com hash no nome) e os ícones, em cache-first;
- `/offline.html`, mostrada quando uma navegação não alcança o servidor.

Um único cache (`static-v1`). Trocar `VERSION` em `sw.js` descarta o cache anterior na ativação. `/sw.js` é servido com `Cache-Control: no-cache, no-store` (`next.config.js`) para o navegador sempre buscar a versão nova; o worker novo assume na hora (`skipWaiting` + `clients.claim`), o que é seguro porque nenhum HTML fica em cache.

A decisão de cada requisição é uma função pura (`strategyFor`), testada em `lib/service-worker.test.ts`.

## Instalação

- **Chrome, Edge, Android:** aparece o botão **Instalar app** na barra superior quando o navegador considera o app instalável. Também funciona pelo menu do navegador.
- **iPhone/iPad (Safari):** não existe evento de instalação; use Compartilhar → "Adicionar à Tela de Início". As metatags `apple-mobile-web-app-*` e o ícone de 180px estão presentes.
- O app instalado abre em `/dashboard`; sem sessão, o middleware leva ao `/login` como sempre.

## Sem conexão

- **Aparelho sem rede com o painel aberto:** aparece a faixa "Sem conexão". As telas continuam tratando o erro de cada requisição como antes; nada é enfileirado.
- **Abrir o app sem alcançar a API:** antes, qualquer falha ao restaurar a sessão mandava o operador para o login. Agora só uma **recusa** (`401`/`403`) faz isso. Sem resposta (rede, API fora do ar, `5xx`), o painel mostra "Não foi possível falar com o servidor… sua sessão continua aberta", com botão de nova tentativa, e tenta sozinho quando o aparelho volta a ter rede (`lib/auth-context.tsx`, `isSessionRefusal` em `lib/session-area.ts`).
- **Servidor web inalcançável:** a navegação cai na página offline.

## Avisos de pedido novo (não é push)

O botão **Avisar pedidos** na barra superior liga uma notificação do sistema quando a quantidade de pedidos aguardando confirmação **aumenta** e a tela **não está à vista** (outra aba, outro app na frente). Com a tela à vista não há notificação: o chip "N novos" e o som da cozinha já avisam.

- A permissão é pedida no clique; a preferência fica no navegador, por usuário.
- Usa o mesmo polling que alimenta o chip (20 s), que passa a continuar em segundo plano enquanto os avisos estão ligados.
- **Limite real:** depende do app aberto. Com o app fechado, ou suspenso pelo sistema do aparelho, nada chega.

### Push de verdade: NÃO implementado

Motivo: falta infraestrutura. Web push exige par de chaves VAPID, armazenamento das inscrições por usuário/aparelho (tabela nova), um emissor no backend (dependência nova) e um ponto de disparo nos eventos de pedido. Nada disso existe hoje. O worker já trata o clique em notificação e só abre caminhos do próprio painel; quando o emissor existir, falta acrescentar o listener `push`.

## Experiência com o dedo

- Variante Tailwind **`touch:`** (`@media (pointer: coarse)`, em `tailwind.config.ts`): vale em celulares e tablets, não em computador com mouse. O desktop mantém a densidade compacta.
- Botões, campos, seletores, abas em pílula, chips clicáveis, itens da barra lateral e ícones de ação passam a ter **40–44px** de área de toque nesses aparelhos.
- Campos usam texto de **16px** no toque: com menos que isso o iOS dá zoom na página ao focar.
- O zoom do usuário **não** é bloqueado.
- **Cozinha no celular:** as colunas de status deixam de ser caixas baixas com rolagem interna; cada uma cresce com seus pedidos e o quadro inteiro rola. Em tablet e desktop o quadro fixo com rolagem por coluna continua.

Auditado em 390×844, 820×1180 e 1366×900 nas telas Pedidos, detalhe do pedido, Cozinha, PDV (incluindo a venda aberta no celular), Delivery, Mesas, comanda, Caixa, Visão geral e Login: nenhuma rolagem lateral de página; nenhum controle abaixo de 40px no toque, exceto links dentro de frases.

## Limitações

- Sem push com o app fechado (acima).
- Sem operação offline: sem rede não se vende, não se recebe e não se muda status. É uma decisão, não uma pendência: uma fila offline de vendas exigiria reconciliação de estoque, caixa, cupom, cashback e limite de fiado.
- Os ícones são da plataforma, não do restaurante (o manifest é único, não por tenant).
- Sem tela de "nova versão disponível": a atualização do worker é silenciosa.
- Em iOS a instalação é manual e as notificações só existem em app instalado na tela de início (iOS 16.4+).
- Não validado em aparelhos físicos; a validação foi em Chrome com emulação de tela e de toque.

## Como testar localmente

O worker só registra em build de produção:

```bash
pnpm --filter web build
API_URL=http://localhost:4000/v1 pnpm --filter web start
```

Em `next dev` não há worker (ele serviria arquivos de build antigos).
