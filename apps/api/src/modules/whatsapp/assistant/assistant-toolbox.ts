import { randomBytes } from 'crypto';
import { Catalog, CatalogProduct, describeOpeningHours } from './catalog';
import { formatCents, isAffirmative, normalize } from './assistant-guards';

// The only things the assistant can do. Every tool works on ONE restaurant (the conversation's)
// and one customer, both fixed by the server before the model runs: no tool takes a restaurant,
// a phone number or a price as input, and none runs SQL. Prices come from priceLines (the same
// OrderCreationService.priceItems the checkout uses), never from the model.
//
// The toolbox keeps the turn's working state (cart, confirmation, checkout link, hand-off). It is
// written to the database by WhatsappReplyService together with the reply, in one transaction,
// so a turn that fails or is answered twice changes nothing.

export interface CartLineOption {
  optionId: string;
  quantity: number;
}

export interface CartLine {
  productId: string;
  quantity: number;
  options: CartLineOption[];
  notes: string | null;
}

export interface PricedLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  subtotalCents: number;
  options: {
    optionId: string;
    name: string;
    group: string;
    quantity: number;
    unitPriceCents: number;
  }[];
  notes: string | null;
}

export class PricingRefused extends Error {}

export interface OrderSummary {
  orderNumber: string;
  status: string;
  totalCents: number;
  createdAt: Date;
}

export interface ToolboxDeps {
  catalog: Catalog;
  // Throws PricingRefused with the customer-facing message when a line is not valid.
  priceLines(lines: CartLine[]): Promise<PricedLine[]>;
  // Orders of THIS customer at THIS restaurant only (matched by phone), most recent first.
  findOrders(): Promise<OrderSummary[]>;
  publicWebUrl: string;
  now: Date;
}

export interface ToolboxState {
  cart: CartLine[];
  cartVersion: number;
  awaitingConfirmationVersion: number | null;
  handoffReason: string | null;
  checkoutLink: { token: string; url: string; expiresAt: Date; cart: CartLine[] } | null;
}

export const MAX_CART_LINES = 20;
export const CHECKOUT_LINK_TTL_MS = 2 * 60 * 60 * 1000;

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'recebido, aguardando confirmação do restaurante',
  CONFIRMED: 'confirmado',
  PREPARING: 'em preparo',
  READY: 'pronto',
  OUT_FOR_DELIVERY: 'saiu para entrega',
  DELIVERED: 'entregue',
  COMPLETED: 'concluído',
  CANCELLED: 'cancelado',
};

type ToolResult = Record<string, unknown>;

export class AssistantToolbox {
  readonly allowedCents = new Set<number>();
  readonly calls: { name: string; ok: boolean }[] = [];
  // A deterministic text the reply can fall back to when a model's wording fails a guard.
  lastSafeText: string | null = null;

  constructor(
    private readonly deps: ToolboxDeps,
    readonly state: ToolboxState,
    readonly lastCustomerText: string,
  ) {}

  get catalog(): Catalog {
    return this.deps.catalog;
  }

  // ---- catalogue ---------------------------------------------------------------------------

  listCategories(): ToolResult {
    const categories = this.catalog.categories.map((c) => ({
      id: c.id,
      nome: c.name,
      produtos: c.productIds.length,
    }));
    return this.ok('listar_categorias', {
      restaurante: this.catalog.restaurantName,
      categorias: categories,
    });
  }

  searchProducts(term?: string | null, categoryId?: string | null): ToolResult {
    const wanted = term ? normalize(term) : '';
    const words = wanted.split(' ').filter((w) => w.length > 2);
    const found = this.catalog.products
      .filter((p) => !categoryId || p.categoryId === categoryId)
      .filter((p) => {
        if (words.length === 0) return true;
        const haystack = normalize(`${p.name} ${p.description ?? ''} ${p.categoryName}`);
        return words.every((w) => haystack.includes(w.replace(/s$/, '')));
      })
      .slice(0, 15)
      .map((p) => this.productBrief(p));
    return this.ok('buscar_produtos', { produtos: found, total: found.length });
  }

  productDetails(productId: string): ToolResult {
    const product = this.product(productId);
    if (!product)
      return this.fail('detalhar_produto', 'Produto não encontrado no cardápio deste restaurante.');
    this.allowedCents.add(product.priceCents);
    return this.ok('detalhar_produto', {
      ...this.productBrief(product),
      descricao: product.description,
      grupos_de_adicionais: product.groups.map((g) => ({
        id: g.id,
        nome: g.name,
        obrigatorio: g.minSelect > 0,
        minimo: g.minSelect,
        maximo: g.maxSelect,
        opcoes: g.options.map((o) => {
          this.allowedCents.add(o.priceCents);
          return {
            id: o.id,
            nome: o.name,
            preco: formatCents(o.priceCents),
            preco_centavos: o.priceCents,
            maximo_por_item: o.maxQuantity,
          };
        }),
      })),
    });
  }

  openingHours(): ToolResult {
    const lines = describeOpeningHours(this.catalog.openingHours);
    return this.ok('horarios_funcionamento', {
      aberto_agora: this.catalog.openNow,
      horarios: lines.length > 0 ? lines : 'O restaurante não informou os horários.',
    });
  }

  deliveryFees(): ToolResult {
    const d = this.catalog.delivery;
    for (const cents of [d.feeCents, d.minOrderCents, d.freeAboveCents])
      if (cents !== null) this.allowedCents.add(cents);
    return this.ok('taxas_entrega', {
      entrega_disponivel: d.enabled,
      taxa: formatCents(d.feeCents),
      pedido_minimo: d.minOrderCents > 0 ? formatCents(d.minOrderCents) : 'sem mínimo',
      entrega_gratis_acima_de: d.freeAboveCents === null ? null : formatCents(d.freeAboveCents),
      observacao: 'A taxa final é calculada no checkout.',
    });
  }

  async orderStatus(orderNumber?: string | null): Promise<ToolResult> {
    const orders = await this.deps.findOrders();
    const wanted = orderNumber ? orderNumber.replace(/\D/g, '') : '';
    const matching = wanted
      ? orders.filter((o) => o.orderNumber.replace(/\D/g, '').endsWith(wanted))
      : orders.slice(0, 3);
    if (matching.length === 0) {
      return this.fail(
        'status_pedido',
        wanted
          ? 'Não encontrei esse pedido feito com este número de WhatsApp.'
          : 'Não encontrei pedidos recentes feitos com este número de WhatsApp.',
      );
    }
    return this.ok('status_pedido', {
      pedidos: matching.map((o) => {
        this.allowedCents.add(o.totalCents);
        return {
          numero: o.orderNumber,
          situacao: ORDER_STATUS_LABEL[o.status] ?? o.status,
          total: formatCents(o.totalCents),
          feito_em: o.createdAt.toISOString(),
        };
      }),
    });
  }

  // ---- cart --------------------------------------------------------------------------------

  // The required groups of `line` that are not satisfied, with what can be chosen.
  missingRequired(
    line: CartLine,
  ): { id: string; name: string; minSelect: number; options: string[] }[] {
    const product = this.product(line.productId);
    if (!product) return [];
    return product.groups
      .filter((g) => g.minSelect > 0)
      .filter((g) => {
        const ids = new Set(g.options.map((o) => o.id));
        const chosen = line.options
          .filter((o) => ids.has(o.optionId))
          .reduce((s, o) => s + o.quantity, 0);
        return chosen < g.minSelect;
      })
      .map((g) => ({
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        options: g.options.map((o) => o.name),
      }));
  }

  async addToCart(input: CartLine): Promise<ToolResult> {
    const product = this.product(input.productId);
    if (!product)
      return this.fail(
        'adicionar_ao_carrinho',
        'Produto não encontrado no cardápio deste restaurante.',
      );
    if (product.soldOut)
      return this.fail('adicionar_ao_carrinho', `"${product.name}" está esgotado no momento.`);
    const quantity = Math.trunc(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 50) {
      return this.fail('adicionar_ao_carrinho', 'A quantidade deve ser de 1 a 50.');
    }
    const line: CartLine = {
      productId: product.id,
      quantity,
      options: mergeOptions(input.options ?? []),
      notes: input.notes ? input.notes.trim().slice(0, 140) || null : null,
    };
    const missing = this.missingRequired(line);
    if (missing.length > 0) {
      return this.fail(
        'adicionar_ao_carrinho',
        `Para "${product.name}" é preciso escolher: ${missing.map((m) => m.name).join(', ')}.`,
        {
          motivo: 'ESCOLHA_OBRIGATORIA',
          grupos_faltando: missing.map((m) => ({
            id: m.id,
            nome: m.name,
            minimo: m.minSelect,
            opcoes: m.options,
          })),
        },
      );
    }

    const next = [...this.state.cart];
    const same = next.findIndex((l) => sameLine(l, line));
    if (same >= 0) next[same] = { ...next[same], quantity: next[same].quantity + line.quantity };
    else next.push(line);
    if (next.length > MAX_CART_LINES)
      return this.fail(
        'adicionar_ao_carrinho',
        `O carrinho aceita até ${MAX_CART_LINES} itens diferentes.`,
      );

    const priced = await this.tryPrice('adicionar_ao_carrinho', next);
    if (!Array.isArray(priced)) return priced;
    this.commitCart(next);
    return this.ok('adicionar_ao_carrinho', {
      adicionado: product.name,
      carrinho: this.cartView(priced),
    });
  }

  async removeFromCart(itemNumber: number): Promise<ToolResult> {
    const index = Math.trunc(itemNumber) - 1;
    if (index < 0 || index >= this.state.cart.length)
      return this.fail('remover_do_carrinho', 'Esse item não está no carrinho.');
    const next = this.state.cart.filter((_, i) => i !== index);
    const priced = await this.tryPrice('remover_do_carrinho', next);
    if (!Array.isArray(priced)) return priced;
    this.commitCart(next);
    return this.ok('remover_do_carrinho', { carrinho: this.cartView(priced) });
  }

  async clearCart(): Promise<ToolResult> {
    this.commitCart([]);
    return this.ok('limpar_carrinho', { carrinho: this.cartView([]) });
  }

  async viewCart(): Promise<ToolResult> {
    const priced = await this.tryPrice('ver_carrinho', this.state.cart);
    if (!Array.isArray(priced)) return priced;
    return this.ok('ver_carrinho', { carrinho: this.cartView(priced) });
  }

  // Shows the summary and opens the confirmation: the link can only be made for THIS version of
  // the cart, after the customer answers "sim".
  async summaryForConfirmation(): Promise<ToolResult> {
    if (this.state.cart.length === 0) return this.fail('mostrar_resumo', 'O carrinho está vazio.');
    const priced = await this.tryPrice('mostrar_resumo', this.state.cart);
    if (!Array.isArray(priced)) return priced;
    this.state.awaitingConfirmationVersion = this.state.cartVersion;
    const summary = this.summaryText(priced);
    this.lastSafeText = `${summary}\n\nPosso gerar o link para você finalizar o pedido? Responda *sim* para confirmar.`;
    return this.ok('mostrar_resumo', {
      carrinho: this.cartView(priced),
      resumo: summary,
      proximo_passo:
        'Pergunte se o cliente confirma. Só gere o link depois que ele responder "sim".',
    });
  }

  async createCheckoutLink(): Promise<ToolResult> {
    if (this.state.cart.length === 0)
      return this.fail('gerar_link_checkout', 'O carrinho está vazio.');
    if (this.state.awaitingConfirmationVersion !== this.state.cartVersion) {
      return this.fail(
        'gerar_link_checkout',
        'Mostre o resumo do carrinho ao cliente e peça a confirmação antes de gerar o link.',
      );
    }
    if (!isAffirmative(this.lastCustomerText)) {
      return this.fail(
        'gerar_link_checkout',
        'O cliente ainda não confirmou o resumo com um "sim".',
      );
    }
    const priced = await this.tryPrice('gerar_link_checkout', this.state.cart);
    if (!Array.isArray(priced)) return priced;
    const token = randomBytes(32).toString('base64url');
    const url = `${this.deps.publicWebUrl}/menu/${this.catalog.slug}/whatsapp/${token}`;
    this.state.checkoutLink = {
      token,
      url,
      expiresAt: new Date(this.deps.now.getTime() + CHECKOUT_LINK_TTL_MS),
      cart: this.state.cart.map((l) => ({ ...l, options: [...l.options] })),
    };
    this.state.awaitingConfirmationVersion = null;
    const subtotal = priced.reduce((s, l) => s + l.subtotalCents, 0);
    this.allowedCents.add(subtotal);
    this.lastSafeText =
      `Pronto! Finalize seu pedido por este link (válido por 2 horas):\n${url}\n\n` +
      'No link você confere os itens, escolhe entrega ou retirada e a forma de pagamento. O pedido só é feito quando você confirmar lá.';
    return this.ok('gerar_link_checkout', {
      link: url,
      valido_por: '2 horas',
      subtotal: formatCents(subtotal),
      aviso:
        'O pedido só é registrado quando o cliente confirmar no checkout. Taxa de entrega e pagamento são escolhidos lá.',
    });
  }

  handoff(reason: string): ToolResult {
    this.state.handoffReason = reason.slice(0, 200) || 'pedido do cliente';
    return this.ok('transferir_para_atendente', { transferido: true });
  }

  // ---- tool dispatch for model providers -------------------------------------------------

  async run(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
    const n = (k: string) => (typeof input[k] === 'number' ? (input[k] as number) : NaN);
    switch (name) {
      case 'listar_categorias':
        return this.listCategories();
      case 'buscar_produtos':
        return this.searchProducts(s('termo'), s('categoria_id'));
      case 'detalhar_produto':
        return this.productDetails(s('produto_id') ?? '');
      case 'horarios_funcionamento':
        return this.openingHours();
      case 'taxas_entrega':
        return this.deliveryFees();
      case 'status_pedido':
        return this.orderStatus(s('numero'));
      case 'adicionar_ao_carrinho': {
        const raw = Array.isArray(input.adicionais) ? input.adicionais : [];
        const options = raw
          .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null)
          .map((o) => ({
            optionId: String(o.adicional_id ?? ''),
            quantity: Number(o.quantidade ?? 1),
          }))
          .filter(
            (o) =>
              o.optionId && Number.isInteger(o.quantity) && o.quantity >= 1 && o.quantity <= 50,
          );
        return this.addToCart({
          productId: s('produto_id') ?? '',
          quantity: n('quantidade'),
          options,
          notes: s('observacao'),
        });
      }
      case 'remover_do_carrinho':
        return this.removeFromCart(n('item'));
      case 'limpar_carrinho':
        return this.clearCart();
      case 'ver_carrinho':
        return this.viewCart();
      case 'mostrar_resumo':
        return this.summaryForConfirmation();
      case 'gerar_link_checkout':
        return this.createCheckoutLink();
      case 'transferir_para_atendente':
        return this.handoff(s('motivo') ?? 'pedido do cliente');
      default:
        return this.fail(name, 'Ferramenta desconhecida.');
    }
  }

  // ---- helpers -----------------------------------------------------------------------------

  product(id: string): CatalogProduct | undefined {
    return this.catalog.products.find((p) => p.id === id);
  }

  summaryText(priced: PricedLine[]): string {
    const lines = priced.map((l, i) => {
      const extras = l.options
        .map((o) => `   + ${o.quantity > 1 ? `${o.quantity}× ` : ''}${o.name}`)
        .join('\n');
      const note = l.notes ? `\n   Obs.: ${l.notes}` : '';
      return `${i + 1}. ${l.quantity}× ${l.name} — ${formatCents(l.subtotalCents)}${extras ? `\n${extras}` : ''}${note}`;
    });
    const subtotal = priced.reduce((s, l) => s + l.subtotalCents, 0);
    return `*Resumo do pedido*\n${lines.join('\n')}\n\nSubtotal: ${formatCents(subtotal)}\n(taxa de entrega e pagamento no checkout)`;
  }

  private productBrief(p: CatalogProduct) {
    this.allowedCents.add(p.priceCents);
    return {
      id: p.id,
      nome: p.name,
      categoria: p.categoryName,
      preco: formatCents(p.priceCents),
      preco_centavos: p.priceCents,
      esgotado: p.soldOut,
      tem_adicionais: p.groups.length > 0,
      tem_escolha_obrigatoria: p.groups.some((g) => g.minSelect > 0),
    };
  }

  private cartView(priced: PricedLine[]) {
    const subtotal = priced.reduce((s, l) => s + l.subtotalCents, 0);
    this.allowedCents.add(subtotal);
    return {
      itens: priced.map((l, i) => {
        this.allowedCents.add(l.unitPriceCents);
        this.allowedCents.add(l.subtotalCents);
        for (const o of l.options) this.allowedCents.add(o.unitPriceCents);
        return {
          item: i + 1,
          produto: l.name,
          quantidade: l.quantity,
          preco_unitario: formatCents(l.unitPriceCents),
          subtotal: formatCents(l.subtotalCents),
          adicionais: l.options.map(
            (o) => `${o.quantity}× ${o.name} (${formatCents(o.unitPriceCents)})`,
          ),
          observacao: l.notes,
        };
      }),
      subtotal: formatCents(subtotal),
      vazio: priced.length === 0,
    };
  }

  private async tryPrice(tool: string, lines: CartLine[]): Promise<PricedLine[] | ToolResult> {
    if (lines.length === 0) return [];
    try {
      return await this.deps.priceLines(lines);
    } catch (error) {
      if (error instanceof PricingRefused) return this.fail(tool, error.message);
      throw error;
    }
  }

  private commitCart(next: CartLine[]) {
    this.state.cart = next;
    this.state.cartVersion += 1;
    this.state.awaitingConfirmationVersion = null;
  }

  private ok(name: string, data: ToolResult): ToolResult {
    this.calls.push({ name, ok: true });
    return { ok: true, ...data };
  }

  private fail(name: string, message: string, extra: ToolResult = {}): ToolResult {
    this.calls.push({ name, ok: false });
    return { ok: false, erro: message, ...extra };
  }
}

function mergeOptions(options: CartLineOption[]): CartLineOption[] {
  const byId = new Map<string, number>();
  for (const o of options) byId.set(o.optionId, (byId.get(o.optionId) ?? 0) + o.quantity);
  return [...byId.entries()]
    .map(([optionId, quantity]) => ({ optionId, quantity }))
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
}

function sameLine(a: CartLine, b: CartLine): boolean {
  if (a.productId !== b.productId || (a.notes ?? null) !== (b.notes ?? null)) return false;
  const key = (l: CartLine) =>
    mergeOptions(l.options)
      .map((o) => `${o.optionId}:${o.quantity}`)
      .join(',');
  return key(a) === key(b);
}

// JSON schemas of the tools above, for model providers (strict: arguments always match).
export const ASSISTANT_TOOL_DEFINITIONS = [
  {
    name: 'listar_categorias',
    description: 'Lista as categorias do cardápio deste restaurante.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'buscar_produtos',
    description:
      'Busca produtos do cardápio por nome/termo e/ou categoria. Retorna id, nome, preço e se está esgotado.',
    input_schema: {
      type: 'object',
      properties: {
        termo: {
          type: 'string',
          description: 'Palavras do nome do produto; omita para listar todos.',
        },
        categoria_id: {
          type: 'string',
          description: 'id de uma categoria de listar_categorias (opcional).',
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'detalhar_produto',
    description:
      'Detalha um produto: preço, grupos de adicionais (obrigatórios ou não), opções e limites.',
    input_schema: {
      type: 'object',
      properties: { produto_id: { type: 'string' } },
      required: ['produto_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'horarios_funcionamento',
    description: 'Horários de funcionamento e se o restaurante está aberto agora.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'taxas_entrega',
    description: 'Taxa de entrega, pedido mínimo e entrega grátis deste restaurante.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'status_pedido',
    description: 'Situação dos pedidos feitos com o número de WhatsApp deste cliente (só os dele).',
    input_schema: {
      type: 'object',
      properties: {
        numero: { type: 'string', description: 'Número do pedido; omita para os mais recentes.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'adicionar_ao_carrinho',
    description:
      'Adiciona um produto ao carrinho com adicionais (ids de detalhar_produto) e observação. O sistema valida e calcula o preço.',
    input_schema: {
      type: 'object',
      properties: {
        produto_id: { type: 'string' },
        quantidade: { type: 'integer' },
        adicionais: {
          type: 'array',
          items: {
            type: 'object',
            properties: { adicional_id: { type: 'string' }, quantidade: { type: 'integer' } },
            required: ['adicional_id', 'quantidade'],
            additionalProperties: false,
          },
        },
        observacao: { type: 'string' },
      },
      required: ['produto_id', 'quantidade'],
      additionalProperties: false,
    },
  },
  {
    name: 'remover_do_carrinho',
    description: 'Remove um item do carrinho pelo número dele (item 1, 2, ...).',
    input_schema: {
      type: 'object',
      properties: { item: { type: 'integer' } },
      required: ['item'],
      additionalProperties: false,
    },
  },
  {
    name: 'limpar_carrinho',
    description: 'Esvazia o carrinho.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'ver_carrinho',
    description: 'Mostra o carrinho com os valores calculados pelo sistema.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'mostrar_resumo',
    description:
      'Gera o resumo final do carrinho para o cliente confirmar. Use quando o cliente quiser finalizar.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'gerar_link_checkout',
    description:
      'Gera o link seguro do checkout com o carrinho. Só funciona depois de mostrar_resumo e de o cliente responder "sim".',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'transferir_para_atendente',
    description:
      'Passa a conversa para uma pessoa da equipe (pedido do cliente, reclamação, assunto fora do cardápio).',
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
] as const;
