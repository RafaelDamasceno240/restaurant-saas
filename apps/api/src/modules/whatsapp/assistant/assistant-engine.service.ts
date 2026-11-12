import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';
import { PrismaService } from '../../../prisma/prisma.service';
import { OrderCreationService } from '../../order-creation/order-creation.service';
import { PublicMenuService } from '../../public-menu/public-menu.service';
import { AnthropicAssistant } from './anthropic-assistant';
import { AssistantProvider, HistoryEntry } from './assistant-provider';
import {
  AssistantToolbox,
  CartLine,
  OrderSummary,
  PricedLine,
  PricingRefused,
  ToolboxState,
} from './assistant-toolbox';
import { stripForeignLinks, unverifiedPrices } from './assistant-guards';
import { catalogFromPublicMenu } from './catalog';
import { LocalAssistant } from './local-assistant';

export interface EngineInput {
  tenantId: string;
  tenantSlug: string;
  contactWaId: string;
  customerText: string;
  history: HistoryEntry[];
  state: ToolboxState;
  dialogState: unknown;
  greeting: string | null;
  isFirstContact: boolean;
  behaviorInstructions: string | null;
}

export interface EngineOutput {
  text: string;
  state: ToolboxState;
  dialogState: unknown;
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  fellBack: boolean;
  guardTriggered: boolean;
}

const MAX_REPLY = 3000;
const PRICE_FALLBACK =
  'Não consegui confirmar esse valor agora. Posso te mostrar o cardápio com os preços ou o resumo do seu carrinho.';

// Providers by name. "local" always exists; "anthropic" when configured. Tests and future
// providers register their own (e.g. a provider that always fails).
@Injectable()
export class AssistantProviderRegistry {
  private readonly providers = new Map<string, AssistantProvider>();
  private active: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const ai = config.get('whatsapp', { infer: true }).ai;
    this.register(new LocalAssistant());
    if (ai.provider === 'anthropic') {
      this.register(
        new AnthropicAssistant({ model: ai.model, effort: ai.effort, maxTokens: ai.maxTokens }),
      );
    }
    this.active = this.providers.has(ai.provider) ? ai.provider : 'local';
  }

  register(provider: AssistantProvider): void {
    this.providers.set(provider.name, provider);
  }

  setActive(name: string): void {
    if (!this.providers.has(name)) throw new Error(`unknown assistant provider ${name}`);
    this.active = name;
  }

  get activeName(): string {
    return this.active;
  }

  get(name: string): AssistantProvider {
    return this.providers.get(name) ?? this.providers.get('local')!;
  }
}

function cloneState(state: ToolboxState): ToolboxState {
  return {
    cart: state.cart.map((l) => ({ ...l, options: l.options.map((o) => ({ ...o })) })),
    cartVersion: state.cartVersion,
    awaitingConfirmationVersion: state.awaitingConfirmationVersion,
    handoffReason: null,
    checkoutLink: null,
  };
}

@Injectable()
export class AssistantEngineService {
  private readonly logger = new Logger(AssistantEngineService.name);
  private readonly publicWebUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicMenu: PublicMenuService,
    private readonly orderCreation: OrderCreationService,
    private readonly registry: AssistantProviderRegistry,
    config: ConfigService<AppConfig, true>,
  ) {
    this.publicWebUrl = config.get('publicWebUrl', { infer: true });
  }

  async respond(input: EngineInput): Promise<EngineOutput> {
    const menu = await this.publicMenu.getMenuBySlug(input.tenantSlug);
    const catalog = catalogFromPublicMenu(menu);
    const now = new Date();
    const deps = {
      catalog,
      now,
      publicWebUrl: this.publicWebUrl,
      priceLines: (lines: CartLine[]) => this.priceLines(input.tenantId, lines),
      findOrders: () => this.findOrders(input.tenantId, input.contactWaId),
    };
    const turn = (provider: AssistantProvider) => {
      const toolbox = new AssistantToolbox(deps, cloneState(input.state), input.customerText);
      return provider
        .reply({
          toolbox,
          customerText: input.customerText,
          history: input.history,
          dialogState: input.dialogState,
          restaurantName: catalog.restaurantName,
          behaviorInstructions: input.behaviorInstructions,
        })
        .then((out) => ({ out, toolbox }));
    };

    const primary = this.registry.get(this.registry.activeName);
    let fellBack = false;
    let result: Awaited<ReturnType<typeof turn>>;
    try {
      result = await turn(primary);
    } catch (error) {
      if (primary.name === 'local') throw error;
      // The model provider failed (network, rate limit, refusal loop...): the local assistant
      // answers this turn from the ORIGINAL state, so nothing the failed attempt did survives.
      this.logger.warn(`assistant provider "${primary.name}" failed: ${(error as Error).message}`);
      fellBack = true;
      result = await turn(this.registry.get('local'));
    }

    const { out, toolbox } = result;
    let text = stripForeignLinks(out.text, this.publicWebUrl);
    let guardTriggered = false;
    if (out.provider !== 'local' && unverifiedPrices(text, toolbox.allowedCents).length > 0) {
      // A price that no tool returned in this turn: never sent.
      guardTriggered = true;
      this.logger.warn(
        `assistant reply with an unverified price replaced (tenant ${input.tenantId})`,
      );
      text = toolbox.lastSafeText ?? PRICE_FALLBACK;
    }
    const link = toolbox.state.checkoutLink;
    if (link && !text.includes(link.url)) text = `${text}\n\n${link.url}`;
    if (input.isFirstContact && input.greeting?.trim())
      text = `${input.greeting.trim()}\n\n${text}`;
    if (text.length > MAX_REPLY) text = `${text.slice(0, MAX_REPLY)}…`;

    return {
      text,
      state: toolbox.state,
      dialogState: out.dialogState === undefined ? input.dialogState : out.dialogState,
      provider: out.provider,
      model: out.model,
      inputTokens: out.inputTokens ?? null,
      outputTokens: out.outputTokens ?? null,
      fellBack,
      guardTriggered,
    };
  }

  // The checkout's own pricing: same rules (required groups, limits, sold out, tenant scope).
  async priceLines(tenantId: string, lines: CartLine[]): Promise<PricedLine[]> {
    try {
      const priced = await this.orderCreation.priceItems(
        tenantId,
        lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          options: l.options,
          notes: l.notes,
        })),
        { enforceRequiredOptions: true },
      );
      return priced.map((p) => ({
        productId: p.productId,
        name: p.productNameSnapshot,
        quantity: p.quantity,
        unitPriceCents: p.unitPriceCents,
        subtotalCents: p.unitPriceCents * p.quantity,
        options: (p.options ?? []).map((o) => ({
          optionId: o.optionItemId,
          name: o.optionNameSnapshot,
          group: o.groupNameSnapshot,
          quantity: o.quantity,
          unitPriceCents: o.unitPriceCents,
        })),
        notes: p.notes ?? null,
      }));
    } catch (error) {
      if (error instanceof BadRequestException) {
        const body = error.getResponse() as { message?: string };
        throw new PricingRefused(
          typeof body.message === 'string' ? body.message : 'Item indisponível.',
        );
      }
      throw error;
    }
  }

  // Only orders placed with THIS customer's number, at THIS restaurant, in the last 60 days.
  private async findOrders(tenantId: string, waId: string): Promise<OrderSummary[]> {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const orders = await this.prisma.order.findMany({
      where: { tenantId, customerPhone: { not: null }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        orderNumber: true,
        status: true,
        totalCents: true,
        createdAt: true,
        customerPhone: true,
      },
    });
    const mine = waId.replace(/\D/g, '').slice(-10);
    return orders
      .filter((o) => {
        const digits = (o.customerPhone ?? '').replace(/\D/g, '');
        return digits.length >= 10 && digits.slice(-10) === mine;
      })
      .slice(0, 10)
      .map((o) => ({
        orderNumber: o.orderNumber,
        status: o.status,
        totalCents: o.totalCents,
        createdAt: o.createdAt,
      }));
  }
}
