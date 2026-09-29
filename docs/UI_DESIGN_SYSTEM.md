# Design system e App Shell (UI)

Escopo: **apenas frontend** (`apps/web`). Backend, APIs, RBAC, multi-tenancy e regras de negócio não foram tocados.

## Identidade visual (atualizada)

Toda a aplicação usa a mesma identidade: dashboard, `/demo`, login, cadastro, home e cardápio público. O tema é ativado pela classe `.theme-app` (o `AppShell` a aplica; os layouts de `login`, `register` e `menu` também).

### Paleta oficial (as únicas cores de marca)

| Token | Hex | Papel |
|---|---|---|
| `brand-dark` | `#020001` PRETO | fundo, sidebar, áreas de maior contraste |
| `brand-primary` | `#9F6118` CARAMELO | ação principal: botões primários, ativos, indicadores da marca |
| `brand-accent` | `#C88A3A` DOURADO | destaque: seleção, links, preços, ícones, foco |
| `brand-muted` | `#E5C08A` BEGE | texto secundário, bordas e superfícies suaves (em opacidade) |
| `brand-light` | `#F6E7CF` CREME | texto principal e títulos |

Os hexadecimais existem **somente** em `apps/web/app/globals.css` (`:root`, como triplets RGB). Nenhum componente usa hex.

### Tokens semânticos (`.theme-app`, em `globals.css`)

`--background`, `--foreground`, `--surface` / `--surface-2` / `--surface-hover`, `--border` / `--border-strong`, `--primary` / `--primary-foreground` / `--primary-hover`, `--accent` / `--accent-foreground`, `--muted` / `--muted-foreground`, `--subtle`, `--sidebar`, mais os estados funcionais `--success`, `--warning`, `--danger` (+ `--danger-foreground`) e `--info`.

- As superfícies e bordas **derivam da paleta**: bege sobre preto em 6% (card), 10% (input), 14% (hover), 16% (borda) e 28% (borda forte). Não há sexta cor de marca.
- Os estados funcionais (verde, amarelo, vermelho, azul) só carregam significado (pronto, alerta, erro, confirmado). Ficam pequenos (badges, ícones) para não competir com a identidade.
- O Tailwind expõe os tokens em `tailwind.config.ts`: `bg-background`, `text-foreground`, `bg-surface`, `border-line` (= `--border`), `bg-primary`, `text-accent`, `text-muted-foreground`, etc. Também existe `brand-*` para o caso raro de precisar da cor bruta.

### Tipografia

| Uso | Fonte |
|---|---|
| `h1`, `h2`, `h3` (títulos de página, seção, card, dialog, marca na sidebar) | `Georgia, 'Times New Roman', serif` (`--font-heading`, classe `font-heading`) |
| Todo o resto: subtítulos, labels, botões, menus, tabelas, inputs, badges, navegação, corpo | `Aptos, 'Segoe UI', Arial, sans-serif` (`--font-sans`) |

Nenhum arquivo de fonte externo: o navegador usa a fonte instalada e cai nos fallbacks. Aplicação global em `@layer base` (`h1–h3` em Georgia). **Números (preços, saldos, quantidades) ficam em Aptos de propósito:** Georgia usa algarismos "old-style" que prejudicam a leitura de valores.

### Uso das cores

- **Botão primário** e itens ativos de ação: `bg-primary text-primary-foreground` (caramelo + creme); hover escurece (`primary-hover`).
- **Navegação ativa**: texto dourado sobre fundo dourado a 10% + marcador caramelo de 3px à esquerda.
- **Preços e valores em destaque** (cardápio, PDV, saldo esperado/contado no caixa): `text-accent` (dourado).
- **Status de pedido** (não dependem só da cor: sempre têm rótulo em texto): Novo = dourado, Confirmado = azul, Preparando = caramelo, Pronto = verde, Concluído = neutro, Cancelado = vermelho.
- **KDS**: novo = moldura dourada + pulso + tag "NOVO"; em preparo = moldura caramelo + "EM PREPARO"; pronto = moldura verde + "PRONTO". Cada tag tem ícone e texto.

### Contraste medido (WCAG)

| Par | Razão |
|---|---|
| Creme sobre preto | 17,2:1 |
| Bege 80% (`muted-foreground`) sobre preto / card | 7,9:1 / 7,3:1 |
| Texto terciário (`subtle`) sobre card / input | 5,4:1 / 5,1:1 |
| Dourado sobre preto / card | 7,1:1 / 6,6:1 |
| Bege sobre badge caramelo | 10,0:1 |
| Creme sobre caramelo `#9F6118` (**botão primário**) | **4,11:1** |
| Creme sobre caramelo escurecido (hover) | 5,4:1 |
| Preto sobre botão de perigo / sucesso | 6,4:1 / 9,2:1 |

**Ressalva assumida:** o botão primário (creme sobre o caramelo oficial `#9F6118`) fica em 4,11:1, acima do mínimo de 3:1 para texto grande e componentes de UI, mas **abaixo de 4,5:1** para texto pequeno. Foi mantido o tom oficial (pedido explícito) e o rótulo é sempre semibold; o estado hover, mais escuro, passa de 5:1. Regras que evitam combinações ruins: nunca usar dourado sobre caramelo (o marcador de item selecionado do PDV usa borda caramelo) nem caramelo como cor de texto sobre preto (4,18:1); textos de destaque usam dourado.

Raios: `rounded-ctl` (0.5rem, controles) e `rounded-card` (0.75rem). Animações discretas (`animate-fade-in`, `pop-in`, `slide-in-left`, `toast-in`, `pulse-ring`); `prefers-reduced-motion` é respeitado.

## Componentes (`components/ds/`)

`Button` (primary, secondary, outline, ghost, danger, danger-ghost; sm/md/lg/icon; `loading`), `Badge` (tons), `Card`/`CardHeader`, `Input`/`Textarea`/`Select`/`SearchInput`/`Field`, `Tabs` (underline e pill), `Table*`, `Dialog`/`ConfirmDialog`, `Dropdown`, `Tooltip` (CSS), `Toast` (`ToastProvider` + `useToast`), `States` (`LoadingState`, `EmptyState`, `ErrorState`, `Alert`, `Skeleton`, `Spinner`), `StatCard`, `Page`/`PageHeader`, `Switch` (fase 09), `TabLinks` (abas navegáveis por rota, usadas no estoque).

Regra: escolher `variant`, não sobrescrever cores por `className` (o Tailwind não garante a ordem).

## App Shell (`components/shell/`)

- `AppShell`: sidebar + topbar + `<main>` rolável. Compartilhado por `/dashboard` (via `app/dashboard/layout.tsx`, que também faz o guard de auth real) e `/demo` (via `DemoShell`).
- `Sidebar`: ícones lucide + texto, grupos com separador, estado ativo, tooltip quando colapsada. Colapsável (preferência em `localStorage`, padrão colapsada abaixo de 1280px), vira drawer abaixo de `md`. Rodapé: ajuda, suporte, usuário, e-mail, Sair.
- `Topbar` + `Chip`: chips reutilizáveis. `DashboardChips` usa dados reais (unidade, caixa aberto/fechado, pedidos novos); `DemoChips` usa valores fictícios.
- `nav.ts`: definição de navegação. `roles` é só uma dica de UI (mesmas listas que o dashboard antigo já usava); a barreira real continua no backend. Módulos inexistentes (Estoque, Usuários, Configurações, Mais recursos, Ajuda, Suporte) aparecem desabilitados como "Em breve".
- Unidade ativa: `ActiveBranchProvider` (em `lib/use-active-branch.ts`) mantém uma única seleção, escolhida na topbar e lida por PDV, Caixa e Mesas.

## Breakpoints

- `< md` (768): sidebar em drawer; PDV com carrinho em tela cheia aberta por barra inferior.
- `md–xl`: sidebar colapsada por padrão.
- `lg` (1024): PDV em duas colunas (catálogo + carrinho fixo).
- `xl` (1280): sidebar expandida por padrão; KDS em 4 colunas.

## Padrões

Toda página: `Page` + `PageHeader`, estados loading/empty/error explícitos, toasts para sucesso, `Dialog` no lugar de formulários inline e `window.confirm`. Telas de operação (PDV, KDS) preenchem a altura do `<main>` e têm alvos de toque ≥ 36–44px.
