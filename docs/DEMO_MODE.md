# Modo Demonstração (`/demo`)

Rota de apresentação visual da plataforma, criada para demonstrar o produto
sem depender de PostgreSQL, Redis ou de qualquer dado real. Não faz parte do
fluxo real da aplicação e não deve ser usada como referência de regra de
negócio — para isso, ver `docs/PROJECT_STATUS.md` e o código de
`apps/api`/`apps/web` fora de `demo/`.

## Como acessar

Com `pnpm dev:web` (ou `pnpm dev`) rodando, abrir:

```
http://localhost:3000/demo
```

Não exige login, não exige `refresh_token` (a rota não está no `matcher` de
`apps/web/middleware.ts`, que só cobre `/dashboard/:path*`), não exige a API
nem o banco no ar — nenhuma tela de `/demo` faz `fetch`.

Telas disponíveis:

| Rota               | Conteúdo                                                 |
| ------------------ | --------------------------------------------------------- |
| `/demo`          | Dashboard: indicadores do dia + cards dos módulos        |
| `/demo/cardapio` | Categorias e produtos, com preço e disponibilidade       |
| `/demo/pedidos`  | Painel de pedidos por status (Novos → Finalizados)       |
| `/demo/cozinha`  | KDS — cards grandes por Novos/Preparando/Prontos         |
| `/demo/pdv`      | Balcão interativo: carrinho local, sem criar pedido real |
| `/demo/caixa`    | Sessão de caixa, movimentações e diferença            |
| `/demo/estoque`  | Estoque: 67 produtos, insumos, estoque baixo, movimentos (fictícios, `lib/demo/inventory.ts`) |

## O que é fictício

**Tudo.** Todos os números, pedidos, produtos e movimentações de caixa vêm de
uma única fonte estática: `apps/web/lib/demo/data.ts` (tipos em
`apps/web/lib/demo/types.ts`). Não há nenhuma chamada a
`apps/web/lib/api-client.ts` nem a qualquer endpoint de `apps/api` em nenhum
arquivo dentro de `app/demo/**` ou `components/demo/**`.

O único ponto "interativo" é `/demo/pdv`: adicionar/remover itens do
carrinho e trocar forma de pagamento acontece só em `useState` local
(`apps/web/lib/demo/pdv-logic.ts`, funções puras, mesmo padrão do
`lib/pos-logic.ts` real, mas deliberadamente **não** o mesmo módulo — ver o
comentário no topo do arquivo). Clicar em "FINALIZAR VENDA" nunca chama a
API; só mostra a mensagem "Venda demonstrativa finalizada" e limpa o
carrinho local.

## Nenhuma persistência

- Nenhuma linha escrita no Postgres.
- Nenhuma chamada ao Redis.
- Nenhuma migration nova, nenhuma alteração de schema Prisma.
- Nenhuma rota de `apps/api` foi criada, alterada ou chamada.
- O estado do carrinho do PDV demonstrativo vive só em memória da aba aberta
  — recarregar a página zera o carrinho (comportamento esperado, não é bug).

Um aviso fixo no rodapé de toda página `/demo/*` (via
`components/demo/DemoShell.tsx`) e um selo "Modo demonstração" no topo
deixam isso explícito na própria tela, para quem estiver assistindo à
apresentação.

## Consistência interna dos dados fictícios

Os números não foram escolhidos por acaso:

- `demoStats.inPreparation` (6) é exatamente a quantidade de pedidos com
  status `PREPARING` na lista `demoOrders` — a mesma lista usada por
  `/demo/pedidos` e `/demo/cozinha`.
- Os pedidos `#1042` (R$ 74,70) e `#1041` (R$ 36,90) batem exatamente com
  quantidade × preço unitário dos produtos em `demoProducts`.
- No caixa, `esperado = abertura + vendas em dinheiro + suprimentos - sangrias` (R$ 200 + R$ 1.280 + R$ 100 − R$ 150 = R$ 1.430) e a soma das
  linhas de `VENDA` na tabela de movimentações soma exatamente os
  R$ 1.280,00 de "vendas em dinheiro" — não são dois números
  desencontrados.

## Como remover o modo demonstração depois

Tudo vive isolado nestes caminhos — apagar é seguro, nada fora deles
depende disso:

- `apps/web/app/demo/` (rota inteira: layout + 6 páginas)
- `apps/web/components/demo/` (todos os componentes visuais do módulo)
- `apps/web/lib/demo/` (dados, tipos e lógica do carrinho do PDV demo)
- O bloco de CSS marcado com o comentário `/* Used only by /demo ... */`
  em `apps/web/app/globals.css` (`@keyframes demo-highlight` +
  `.demo-highlight-once`)
- Esta página, `docs/DEMO_MODE.md`

Nenhum outro arquivo do projeto importa nada de `lib/demo/` ou
`components/demo/`, e `app/demo/` não é referenciado por nenhuma outra rota
— confirmado por busca (`grep -r "demo/" apps/web/app apps/web/components apps/web/lib`, excluindo a própria pasta `demo/`) antes de fechar esta
tarefa.
