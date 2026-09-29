import type { RestaurantProfile } from '../restaurant-profile';

export const demoRestaurantProfile: RestaurantProfile = {
  name: "Do'cê Hamburgueria e Confeitaria",
  category: 'Hamburgueria • Confeitaria',
  location: 'Minas Gerais, Brasil',
  description:
    "Especializada em hambúrgueres artesanais, combos, porções e confeitaria, a Do'cê Hamburgueria e Confeitaria reúne sabor, praticidade e uma experiência digital completa para seus clientes.",
  legalName: 'Não informado',
  document: 'Não informado',
  phone: '(00) 00000-0000',
  email: 'Não informado',
  slug: 'doce-hamburgueria',
  address: {
    street: 'Rua Principal, 100',
    district: 'Centro',
    region: 'Minas Gerais, Brasil',
  },
  hours: [
    { day: 'Segunda', label: 'Fechado' },
    { day: 'Terça', label: '18:00 — 23:00' },
    { day: 'Quarta', label: '18:00 — 23:00' },
    { day: 'Quinta', label: '18:00 — 23:00' },
    { day: 'Sexta', label: '18:00 — 00:00' },
    { day: 'Sábado', label: '18:00 — 00:00' },
    { day: 'Domingo', label: '18:00 — 23:00' },
  ],
  channels: [
    { key: 'whatsapp', label: 'WhatsApp', value: null },
    { key: 'instagram', label: 'Instagram', value: null },
    { key: 'phone', label: 'Telefone', value: '(00) 00000-0000' },
    { key: 'menu', label: 'Site / Cardápio', value: '/menu/doce-hamburgueria' },
  ],
  operations: [
    { key: 'online', label: 'Pedidos online', description: 'Cardápio digital e checkout', status: 'active' },
    { key: 'delivery', label: 'Delivery', description: 'Entrega no endereço do cliente', status: 'not_configured' },
    { key: 'pickup', label: 'Retirada', description: 'Retirada no balcão', status: 'active' },
    { key: 'counter', label: 'Balcão', description: 'Venda presencial', status: 'active' },
    { key: 'tables', label: 'Mesas', description: 'Mesas e comandas', status: 'active' },
    { key: 'pos', label: 'PDV', description: 'Ponto de venda', status: 'active' },
    { key: 'kds', label: 'KDS', description: 'Painel da cozinha', status: 'active' },
    { key: 'cash', label: 'Caixa', description: 'Abertura, sangria e fechamento', status: 'active' },
  ],
  metrics: [
    { key: 'orders', label: 'Pedidos hoje', value: '87', hint: 'Pedidos não cancelados' },
    { key: 'sales', label: 'Vendas hoje', value: 'R$ 2.438,50', hint: 'Total do dia' },
    { key: 'ticket', label: 'Ticket médio', value: 'R$ 28,03', hint: 'Vendas ÷ pedidos' },
    { key: 'products', label: 'Produtos ativos', value: '32', hint: 'No cardápio' },
    { key: 'customers', label: 'Clientes', value: '1.248', hint: 'Cadastrados' },
  ],
  status: 'open',
  demo: { profile: true, address: true, hours: true, channels: true, metrics: true },
};
