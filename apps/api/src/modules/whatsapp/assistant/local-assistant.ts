import { AssistantProvider, AssistantTurnInput, AssistantTurnOutput } from './assistant-provider';
import { AssistantToolbox, CartLine, CartLineOption } from './assistant-toolbox';
import { CatalogGroup, CatalogProduct } from './catalog';
import { formatCents, isAffirmative, isNegative, normalize, numberWord } from './assistant-guards';

// The rule-based assistant: no network, no cost, deterministic. It understands the usual order
// messages in Portuguese ("quero 2 smash com bacon extra sem cebola", "cardápio", "horário",
// "taxa de entrega", "fechar", "sim") and works through the same toolbox as any model, so the
// prices and the rules are the server's. It is the default provider and the fallback when a model
// provider fails.

interface PendingChoice {
  line: CartLine;
  groupId: string;
  offered: string[];
}

export interface LocalDialogState {
  pending?: PendingChoice | null;
}

const STOP = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'com',
  'e',
  'o',
  'a',
  'os',
  'as',
  'um',
  'uma',
  'no',
  'na',
]);

const has = (text: string, words: string[]) => {
  const padded = ` ${text} `;
  return words.some((w) => padded.includes(` ${w} `));
};

const tokens = (text: string) =>
  normalize(text)
    .split(' ')
    .filter((t) => t.length > 1 && !STOP.has(t));

const singular = (t: string) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);

// How much of `name` appears in `text` (0..1).
function score(name: string, text: string): number {
  const wanted = tokens(name).map(singular);
  if (wanted.length === 0) return 0;
  const present = new Set(tokens(text).map(singular));
  const matched = wanted.filter((t) => present.has(t)).length;
  if (` ${normalize(text)} `.includes(` ${normalize(name)} `)) return 1;
  return matched / wanted.length;
}

function bestProduct(products: CatalogProduct[], text: string): CatalogProduct | null {
  let best: { p: CatalogProduct; s: number } | null = null;
  for (const p of products) {
    const s = score(p.name, text);
    if (s < 0.5) continue;
    if (!best || s > best.s || (s === best.s && p.name.length > best.p.name.length))
      best = { p, s };
  }
  return best?.p ?? null;
}

// Quantity written right before `name` ("2 bacon extra", "duas cocas") or "2x".
function quantityBefore(text: string, name: string): number {
  const n = normalize(text).split(' ');
  const first = singular(tokens(name)[0] ?? '');
  const at = n.findIndex((t) => singular(t) === first);
  if (at > 0) {
    const q = numberWord(n[at - 1]);
    if (q) return q;
  }
  return 1;
}

function optionsIn(
  product: CatalogProduct,
  text: string,
  groups: CatalogGroup[] = product.groups,
): CartLineOption[] {
  const chosen: CartLineOption[] = [];
  for (const group of groups) {
    const ranked = group.options
      .map((o) => ({ o, s: score(o.name, text) }))
      .filter((x) => x.s === 1)
      .sort((a, b) => b.o.name.length - a.o.name.length);
    for (const { o } of ranked) {
      if (chosen.some((c) => c.optionId === o.id)) continue;
      chosen.push({
        optionId: o.id,
        quantity: Math.min(quantityBefore(text, o.name), o.maxQuantity),
      });
    }
  }
  return chosen;
}

function noteIn(original: string, product: CatalogProduct): string | null {
  const optionNames = new Set(
    product.groups.flatMap((g) => g.options.map((o) => normalize(o.name))),
  );
  const notes: string[] = [];
  const re = /\bsem\s+([^,.;!?\n]+?)(?=\s+e\s|\s+com\s|[,.;!?\n]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(original)) !== null) {
    const note = `sem ${m[1].trim()}`;
    if (!optionNames.has(normalize(note))) notes.push(note.toLowerCase());
  }
  return notes.length > 0 ? notes.join(', ').slice(0, 140) : null;
}

interface ItemRequest {
  product: CatalogProduct;
  quantity: number;
  text: string;
}

// "2 smash com bacon e 1 suco de laranja sem gelo" -> two requests, add-ons kept with their item.
function itemRequests(products: CatalogProduct[], text: string): ItemRequest[] {
  const segments = text
    .replace(/^\s*(e|mais)\s+/i, '')
    .split(/,|;|\n|\s+e\s+|\s+mais\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const items: ItemRequest[] = [];
  for (const segment of segments) {
    const current = items[items.length - 1];
    const startsAsOption = /^(com|sem)\b/i.test(normalize(segment));
    const optionOfCurrent = current && optionsIn(current.product, segment).length > 0;
    const product = startsAsOption || optionOfCurrent ? null : bestProduct(products, segment);
    if (product) {
      items.push({
        product,
        quantity: Math.min(quantityBefore(segment, product.name), 50),
        text: segment,
      });
    } else if (current) {
      current.text = `${current.text} ${segment}`;
    }
  }
  return items;
}

const GREETINGS = [
  'oi',
  'ola',
  'oie',
  'bom dia',
  'boa tarde',
  'boa noite',
  'eai',
  'e ai',
  'opa',
  'hey',
  'alo',
];

const HELP =
  'Posso te mostrar o *cardápio*, montar seu pedido (ex.: "quero 2 X-Burger sem cebola"), ' +
  'informar *horário* e *taxa de entrega*, ver o *status do pedido* ou chamar um *atendente*.';

export class LocalAssistant implements AssistantProvider {
  readonly name = 'local';

  async reply(input: AssistantTurnInput): Promise<AssistantTurnOutput> {
    const state: LocalDialogState = (input.dialogState as LocalDialogState) ?? {};
    const text = await this.answer(input.toolbox, input.customerText, state);
    return { text, dialogState: state, provider: this.name, model: null };
  }

  private async answer(
    box: AssistantToolbox,
    original: string,
    state: LocalDialogState,
  ): Promise<string> {
    const text = normalize(original);
    const products = box.catalog.products;

    // 1. A product waiting for a required choice.
    if (state.pending) {
      if (has(text, ['cancelar', 'deixa', 'esquece', 'desistir'])) {
        state.pending = null;
        return 'Tudo bem, não adicionei. Quer outra coisa?';
      }
      const reply = await this.resolvePending(box, original, state);
      if (reply) return reply;
    }

    // 2. The answer to "Posso gerar o link?".
    if (
      box.state.awaitingConfirmationVersion === box.state.cartVersion &&
      box.state.cart.length > 0
    ) {
      if (isAffirmative(original)) {
        const result = await box.createCheckoutLink();
        if (result.ok) return box.lastSafeText!;
        return `Não consegui gerar o link: ${String(result.erro)}`;
      }
      if (isNegative(original)) {
        box.state.awaitingConfirmationVersion = null;
        return 'Sem problemas! O que você quer mudar? Você pode adicionar itens, pedir "remover 1" ou "ver carrinho".';
      }
    }

    if (GREETINGS.includes(text)) return `Olá! 😊 ${HELP}`;

    if (
      has(text, [
        'fechar',
        'finalizar',
        'so isso',
        'e so isso',
        'concluir',
        'fechar pedido',
        'pode fechar',
        'acabou',
        'checkout',
      ])
    ) {
      if (box.state.cart.length === 0)
        return 'Seu carrinho está vazio. Diga o que deseja pedir ou peça o *cardápio*.';
      const result = await box.summaryForConfirmation();
      return result.ok
        ? box.lastSafeText!
        : `Não consegui fechar o carrinho: ${String(result.erro)}`;
    }

    if (has(text, ['limpar carrinho', 'esvaziar', 'limpar', 'cancelar pedido', 'zerar'])) {
      await box.clearCart();
      return 'Carrinho esvaziado. O que vai querer?';
    }

    if (has(text, ['remover', 'tirar', 'tira', 'retirar', 'excluir']))
      return this.remove(box, original, text);

    if (has(text, ['carrinho', 'meu carrinho', 'ver carrinho', 'o que tem no carrinho']))
      return this.cart(box);

    if (
      has(text, ['status', 'cade meu pedido', 'meu pedido', 'acompanhar', 'pedido #']) ||
      /#\s?\d{3,}/.test(original)
    ) {
      const number = original.match(/#?\s?(\d{3,})/)?.[1] ?? null;
      const result = await box.orderStatus(number);
      if (!result.ok) return String(result.erro);
      const orders = result.pedidos as { numero: string; situacao: string; total: string }[];
      return orders
        .map((o) => `Pedido *${o.numero}*: ${o.situacao} (total ${o.total}).`)
        .join('\n');
    }

    if (
      has(text, ['horario', 'horarios', 'aberto', 'abre', 'fecha', 'funciona', 'funcionamento'])
    ) {
      const result = box.openingHours();
      const now =
        result.aberto_agora === true
          ? 'Estamos *abertos* agora.'
          : result.aberto_agora === false
            ? 'Estamos *fechados* agora.'
            : '';
      const hours = Array.isArray(result.horarios)
        ? (result.horarios as string[]).join('\n')
        : String(result.horarios);
      return `${now}\n${hours}`.trim();
    }

    if (has(text, ['taxa', 'frete', 'entrega', 'entregam', 'delivery', 'pedido minimo'])) {
      const d = box.catalog.delivery;
      box.deliveryFees();
      if (!d.enabled) return 'No momento não fazemos entrega; o pedido pode ser retirado no local.';
      const parts = [`A taxa de entrega é ${formatCents(d.feeCents)}.`];
      if (d.minOrderCents > 0) parts.push(`Pedido mínimo: ${formatCents(d.minOrderCents)}.`);
      if (d.freeAboveCents !== null)
        parts.push(`Entrega grátis acima de ${formatCents(d.freeAboveCents)}.`);
      parts.push('O valor final aparece no checkout.');
      return parts.join(' ');
    }

    const asksMenu = has(text, [
      'cardapio',
      'menu',
      'categorias',
      'opcoes',
      'o que voces tem',
      'o que tem',
    ]);
    const asksPrice = has(text, [
      'quanto',
      'preco',
      'valor',
      'custa',
      'o que vem',
      'ingredientes',
      'adicionais',
    ]);

    const requests = itemRequests(products, original);
    if (
      requests.length > 0 &&
      asksPrice &&
      !has(text, ['quero', 'manda', 'adiciona', 'coloca', 'me ve'])
    ) {
      return this.describe(box, requests[0].product);
    }
    if (requests.length > 0 && !asksMenu) return this.add(box, requests, state);

    const category = box.catalog.categories.find((c) => score(c.name, original) === 1);
    if (category) return this.categoryProducts(box, category.id, category.name);

    if (asksMenu || asksPrice) {
      const list = box.listCategories().categorias as { nome: string; produtos: number }[];
      if (list.length === 0) return 'O cardápio ainda não tem produtos disponíveis.';
      return `*Cardápio — ${box.catalog.restaurantName}*\n${list.map((c, i) => `${i + 1}. ${c.nome} (${c.produtos})`).join('\n')}\n\nDiga o nome de uma categoria para ver os produtos e preços.`;
    }

    return `Não entendi bem. ${HELP}`;
  }

  private async add(
    box: AssistantToolbox,
    requests: ItemRequest[],
    state: LocalDialogState,
  ): Promise<string> {
    const added: string[] = [];
    for (const request of requests) {
      const { product } = request;
      if (product.soldOut) {
        added.push(`"${product.name}" está esgotado no momento.`);
        continue;
      }
      const line: CartLine = {
        productId: product.id,
        quantity: request.quantity,
        options: optionsIn(product, request.text),
        notes: noteIn(request.text, product),
      };
      const missing = box.missingRequired(line);
      if (missing.length > 0) {
        // Ask for the first missing choice; what was added before stays in the cart.
        state.pending = { line, groupId: missing[0].id, offered: missing[0].options };
        const prefix = added.length > 0 ? `${added.join('\n')}\n\n` : '';
        return `${prefix}${this.askChoice(product, missing[0].id)}`;
      }
      const result = await box.addToCart(line);
      added.push(
        result.ok
          ? `✅ Adicionei ${request.quantity}× ${product.name}.`
          : `⚠️ ${String(result.erro)}`,
      );
    }
    return `${added.join('\n')}\n\n${await this.cartText(box)}\n\nQuer mais alguma coisa? Quando terminar, diga *fechar*.`;
  }

  private askChoice(product: CatalogProduct, groupId: string): string {
    const group = product.groups.find((g) => g.id === groupId)!;
    const options = group.options
      .map(
        (o, i) =>
          `${i + 1}. ${o.name}${o.priceCents > 0 ? ` (+${formatCents(o.priceCents)})` : ''}`,
      )
      .join('\n');
    const how = group.minSelect > 1 ? `Escolha ${group.minSelect} opções` : 'Escolha uma opção';
    return `Para *${product.name}*: ${how} em *${group.name}*:\n${options}\n\nResponda com o nome ou o número.`;
  }

  private async resolvePending(
    box: AssistantToolbox,
    original: string,
    state: LocalDialogState,
  ): Promise<string | null> {
    const pending = state.pending!;
    const product = box.product(pending.line.productId);
    if (!product) {
      state.pending = null;
      return null;
    }
    const group = product.groups.find((g) => g.id === pending.groupId);
    let chosen = optionsIn(product, original);
    // "2" -> second option offered.
    const n = normalize(original);
    if (chosen.length === 0 && group && /^\d{1,2}$/.test(n)) {
      const option = group.options[Number(n) - 1];
      if (option) chosen = [{ optionId: option.id, quantity: 1 }];
    }
    if (chosen.length === 0) {
      // Not an answer to the question: let the other intents read it, keep the question open.
      if (itemRequests(box.catalog.products, original).length > 0 || n.split(' ').length > 3)
        return null;
      return `Não encontrei essa opção. ${this.askChoice(product, pending.groupId)}`;
    }
    const line: CartLine = {
      ...pending.line,
      options: mergeLineOptions(pending.line.options, chosen),
    };
    const missing = box.missingRequired(line);
    if (missing.length > 0) {
      state.pending = { line, groupId: missing[0].id, offered: missing[0].options };
      return this.askChoice(product, missing[0].id);
    }
    state.pending = null;
    const result = await box.addToCart(line);
    if (!result.ok) return `⚠️ ${String(result.erro)}`;
    return `✅ Adicionei ${line.quantity}× ${product.name}.\n\n${await this.cartText(box)}\n\nQuer mais alguma coisa? Quando terminar, diga *fechar*.`;
  }

  private async remove(box: AssistantToolbox, original: string, text: string): Promise<string> {
    if (box.state.cart.length === 0) return 'Seu carrinho está vazio.';
    const number = text.match(/\b(\d{1,2})\b/)?.[1];
    let index = number ? Number(number) : 0;
    if (!index) {
      const product = bestProduct(
        box.state.cart.map((l) => box.product(l.productId)).filter((p): p is CatalogProduct => !!p),
        original,
      );
      index = product ? box.state.cart.findIndex((l) => l.productId === product.id) + 1 : 0;
    }
    if (!index) return `Qual item você quer remover?\n\n${await this.cartText(box)}`;
    const result = await box.removeFromCart(index);
    if (!result.ok) return String(result.erro);
    return `Removido.\n\n${await this.cartText(box)}`;
  }

  private async cart(box: AssistantToolbox): Promise<string> {
    return `${await this.cartText(box)}${box.state.cart.length > 0 ? '\n\nPara finalizar, diga *fechar*.' : ''}`;
  }

  private async cartText(box: AssistantToolbox): Promise<string> {
    const result = await box.viewCart();
    if (!result.ok) return `⚠️ ${String(result.erro)}`;
    const cart = result.carrinho as {
      itens: {
        item: number;
        produto: string;
        quantidade: number;
        subtotal: string;
        adicionais: string[];
        observacao: string | null;
      }[];
      subtotal: string;
      vazio: boolean;
    };
    if (cart.vazio) return 'Seu carrinho está vazio.';
    const lines = cart.itens.map((i) => {
      const extras = i.adicionais.map((a) => `\n   + ${a}`).join('');
      const note = i.observacao ? `\n   Obs.: ${i.observacao}` : '';
      return `${i.item}. ${i.quantidade}× ${i.produto} — ${i.subtotal}${extras}${note}`;
    });
    return `🛒 *Seu carrinho*\n${lines.join('\n')}\nSubtotal: ${cart.subtotal}`;
  }

  private describe(box: AssistantToolbox, product: CatalogProduct): string {
    box.productDetails(product.id);
    const lines = [
      `*${product.name}* — ${formatCents(product.priceCents)}${product.soldOut ? ' (esgotado)' : ''}`,
    ];
    if (product.description) lines.push(product.description);
    for (const group of product.groups) {
      const options = group.options
        .map((o) => `${o.name}${o.priceCents > 0 ? ` +${formatCents(o.priceCents)}` : ''}`)
        .join(', ');
      lines.push(`${group.name}${group.minSelect > 0 ? ' (obrigatório)' : ''}: ${options}`);
    }
    return lines.join('\n');
  }

  private categoryProducts(box: AssistantToolbox, categoryId: string, name: string): string {
    const result = box.searchProducts(null, categoryId);
    const items = result.produtos as { nome: string; preco: string; esgotado: boolean }[];
    const lines = items.map((p) => `• ${p.nome} — ${p.preco}${p.esgotado ? ' (esgotado)' : ''}`);
    return `*${name}*\n${lines.join('\n')}\n\nPara pedir, diga por exemplo: "quero 1 ${items[0]?.nome ?? 'produto'}".`;
  }
}

function mergeLineOptions(a: CartLineOption[], b: CartLineOption[]): CartLineOption[] {
  const byId = new Map(a.map((o) => [o.optionId, o.quantity]));
  for (const o of b) if (!byId.has(o.optionId)) byId.set(o.optionId, o.quantity);
  return [...byId.entries()].map(([optionId, quantity]) => ({ optionId, quantity }));
}
