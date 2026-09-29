# Perfil do restaurante

Página de perfil de estabelecimento do Do'cê Hamburgueria e Confeitaria, feita para apresentação. É somente frontend: nenhum backend, banco, autenticação ou regra de negócio foi alterado.

## Rotas

| Rota | Modo | Fonte dos dados |
|---|---|---|
| `/dashboard/restaurante` | Real (exige login; visível para OWNER, ADMIN e MANAGER) | `GET /tenants/current` (endpoint já existente) + `GET /orders` para as métricas |
| `/demo/restaurante` | Demonstração (sem login, sem chamadas à API) | `apps/web/lib/demo/restaurant-profile.ts` |

Ambas usam o `AppShell` existente (sidebar + topbar) e aparecem no menu como **Restaurante**, em Gestão.

## Componentes

- `components/restaurante/RestaurantProfileView.tsx`: cabeçalho, Visão rápida, informações, localização, horários, canais e operação.
- `components/restaurante/EditProfileDialog.tsx`: formulário "Editar perfil" (nome, descrição, telefone, e-mail, endereço, horários, Instagram e WhatsApp).
- `lib/restaurant-profile.ts`: tipos, `getCurrentTenant`, `mergeTenantIntoProfile` e `computeOpenStatus`.
- `lib/demo/restaurant-profile.ts`: `demoRestaurantProfile`, a única fonte dos dados fictícios.

Usa o design system (`components/ds`), a logo `/brand/doce-logo.png` e a tipografia já definida (Georgia nos títulos, Aptos no restante).

## Real vs demonstrativo

| Dado | `/dashboard/restaurante` | `/demo/restaurante` |
|---|---|---|
| Nome fantasia, slug | Real (tenant) | Demonstrativo |
| Razão social, documento | Real (tenant); "Não informado" se vazio | "Não informado" |
| Telefone, e-mail | Placeholder `(00) 00000-0000` / "Não informado" | Idem |
| Endereço, horários, canais, descrição | Demonstrativos, com o selo "Dados demonstrativos" | Idem |
| Pedidos, vendas e ticket médio de hoje | Reais (mesma origem da Visão geral) | Demonstrativos |
| Produtos ativos, clientes | "—" (sem API) | Demonstrativos |
| Status Aberto/Fechado | Calculado a partir dos horários e do relógio do navegador | Fixo "Aberto agora" |
| Cards de operação | Refletem o que o sistema oferece; Delivery aparece como Não configurado | Idem |

Nenhum CNPJ, endereço, telefone, e-mail ou rede social real foi inventado.

## Edição

- No modo demo, "Aplicar na apresentação" altera apenas o estado local da página. Recarregar a página restaura os dados.
- No modo real, o formulário é somente leitura e não simula persistência, porque o backend ainda não tem endpoint de atualização.
- Nada do que é digitado ou exibido como demonstrativo é enviado ao backend.
