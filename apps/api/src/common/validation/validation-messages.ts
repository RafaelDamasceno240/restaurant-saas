import { BadRequestException, ValidationError } from '@nestjs/common';

// B8 (piloto 2026-10-23): a guest at the checkout read "customer.name must be longer than or equal
// to 2 characters". class-validator's default messages are English and technical, so every
// validation error goes through here once (StrictValidationPipe's exceptionFactory) and comes out
// as one sentence in Portuguese, naming the field in the words of the screen. Messages a DTO
// already writes in Portuguese ({ message: '...' }) are kept as they are. The error code
// (VALIDATION_ERROR) is the same as before; `details` lists every problem by field.

export interface FieldProblem {
  field: string;
  message: string;
}

// Field names as the screens call them. The last named segment of the path is what is looked up;
// a parent adds context ("nome do cliente", "quantidade do item 2").
const FIELD_LABELS: Record<string, string> = {
  active: 'ativo',
  address: 'endereço',
  allowNegativeStock: 'permitir estoque negativo',
  amountCents: 'valor',
  branchId: 'unidade',
  branchIds: 'unidades',
  branchName: 'nome da unidade',
  cashbackToUseCents: 'cashback a usar',
  categoryId: 'categoria',
  city: 'cidade',
  closes: 'horário de fechamento',
  code: 'código',
  complement: 'complemento',
  countedClosingBalanceCents: 'valor contado',
  countedQuantity: 'quantidade contada',
  couponCode: 'cupom',
  courierUserId: 'entregador',
  cpf: 'CPF',
  creditLimitCents: 'limite de crédito',
  creditTerms: 'condições do fiado',
  currentPassword: 'senha atual',
  customer: 'cliente',
  customerId: 'cliente',
  customerName: 'nome do cliente',
  customerPhone: 'telefone do cliente',
  dateFrom: 'data inicial',
  dateTo: 'data final',
  deliveryNotes: 'instruções de entrega',
  description: 'descrição',
  discountCents: 'desconto',
  discountType: 'tipo de desconto',
  displayOrder: 'ordem de exibição',
  document: 'CNPJ/CPF',
  documentNumber: 'número do documento',
  earnRateBps: 'percentual',
  email: 'e-mail',
  enabled: 'ativo',
  endsAt: 'fim',
  exitReason: 'motivo da saída',
  expireAfterDays: 'validade em dias',
  expiresAt: 'validade',
  feeCents: 'taxa de entrega',
  firstDueDate: 'primeiro vencimento',
  freightCents: 'frete',
  from: 'data inicial',
  fulfillmentType: 'tipo de pedido',
  idempotencyKey: 'identificador da operação',
  imageUrl: 'imagem',
  includeInactive: 'incluir inativos',
  instagram: 'Instagram',
  installmentId: 'parcela',
  installments: 'parcelas',
  inventoryItemId: 'insumo',
  items: 'itens',
  legalName: 'razão social',
  lotCode: 'lote',
  maxDiscountCents: 'desconto máximo',
  maxStock: 'estoque máximo',
  method: 'forma de pagamento',
  minOrderCents: 'pedido mínimo',
  minStock: 'estoque mínimo',
  name: 'nome',
  neighborhood: 'bairro',
  newPassword: 'nova senha',
  notes: 'observação',
  number: 'número',
  openingBalanceCents: 'saldo inicial',
  openingHours: 'horário de funcionamento',
  opens: 'horário de abertura',
  otherCostsCents: 'outros custos',
  page: 'página',
  pageSize: 'itens por página',
  password: 'senha',
  paymentMethod: 'forma de pagamento',
  perCustomerLimit: 'limite por cliente',
  phone: 'telefone',
  points: 'pontos',
  pointsCost: 'custo em pontos',
  pointsPerReal: 'pontos por real',
  price: 'preço',
  productId: 'produto',
  purchaseDate: 'data da compra',
  quantity: 'quantidade',
  reason: 'motivo',
  receiveNow: 'receber agora',
  restaurantSlug: 'restaurante',
  rewardId: 'recompensa',
  role: 'perfil',
  search: 'busca',
  segment: 'segmento',
  sku: 'código (SKU)',
  slug: 'endereço do cardápio',
  sort: 'ordenação',
  startsAt: 'início',
  state: 'UF',
  status: 'situação',
  street: 'rua',
  supplierId: 'fornecedor',
  supplierName: 'fornecedor',
  tableId: 'mesa',
  tenantName: 'nome do restaurante',
  to: 'data final',
  tracksExpiry: 'controlar validade',
  type: 'tipo',
  unit: 'unidade de medida',
  unitCostCents: 'custo unitário',
  usageLimit: 'limite de usos',
  userName: 'nome',
  value: 'valor',
  weekday: 'dia da semana',
  whatsapp: 'WhatsApp',
  zipCode: 'CEP',
};

const PARENT_LABELS: Record<string, string> = {
  customer: 'do cliente',
  address: 'do endereço',
  creditTerms: 'do fiado',
};

// class-validator's own messages read "<property> must ...", "property x should not exist",
// "each value in ... must ...", "nested property ... must ...". A DTO's custom message never does.
function isDefaultMessage(message: string, property: string): boolean {
  const startsLikeDefault = message.startsWith(property) || /^(each value in|nested property|property) /.test(message);
  return (startsLikeDefault && /\b(must|should|has to)\b/.test(message)) || message.startsWith('an unknown value');
}

// The number in a default message ("must not be greater than 50" -> 50), read after the property
// name so a digit in the name never counts.
function numberIn(message: string, property: string): string | null {
  const rest = message.startsWith(property) ? message.slice(property.length) : message;
  return rest.match(/-?\d+(?:\.\d+)?/)?.[0] ?? null;
}

function rule(constraint: string, message: string, property: string): string {
  const n = numberIn(message, property);
  switch (constraint) {
    case 'isNotEmpty':
    case 'isDefined':
      return 'campo obrigatório';
    case 'isString':
      return 'informe um texto';
    case 'minLength':
      return n === '1' ? 'campo obrigatório' : `use pelo menos ${n} caracteres`;
    case 'maxLength':
      return `use no máximo ${n} caracteres`;
    case 'isInt':
      return 'informe um número inteiro';
    case 'isNumber':
    case 'isNumberString':
      return 'informe um número válido';
    case 'min':
      return `o mínimo é ${n}`;
    case 'max':
      return `o máximo é ${n}`;
    case 'isPositive':
      return 'informe um valor maior que zero';
    case 'isEnum':
    case 'isIn':
      return 'opção inválida';
    case 'isUUID':
    case 'isUuid':
      return 'item não encontrado';
    case 'isEmail':
      return 'informe um e-mail válido';
    case 'matches':
      return 'formato inválido';
    case 'isBoolean':
      return 'use sim ou não';
    case 'isDate':
    case 'isDateString':
    case 'isISO8601':
      return 'data inválida';
    case 'isUrl':
      return 'endereço (URL) inválido';
    case 'isArray':
      return 'envie uma lista';
    case 'arrayMinSize':
      return n === '1' ? 'adicione pelo menos 1 item' : `adicione pelo menos ${n} itens`;
    case 'arrayMaxSize':
      return `no máximo ${n} itens`;
    case 'arrayUnique':
      return 'há itens repetidos';
    case 'nestedValidation':
    case 'isObject':
      return 'dados inválidos';
    default:
      return 'valor inválido';
  }
}

// "items.1.quantity" -> "Quantidade do item 2"; "customer.name" -> "Nome do cliente";
// unknown -> null (the sentence then names no field).
export function fieldLabel(path: string): string | null {
  const parts = path.split('.');
  const last = parts[parts.length - 1];
  const base = FIELD_LABELS[last];
  if (!base) return null;
  if (parts.length < 2) return base;
  const parent = parts[parts.length - 2];
  if (/^\d+$/.test(parent)) {
    const owner = parts[parts.length - 3];
    return owner === 'items' ? `${base} do item ${Number(parent) + 1}` : `${base} (${Number(parent) + 1})`;
  }
  return PARENT_LABELS[parent] && !base.includes(' do ') ? `${base} ${PARENT_LABELS[parent]}` : base;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function sentence(path: string, constraint: string, message: string, property: string): string {
  if (constraint === 'whitelistValidation') {
    return 'A requisição tem um campo que não é aceito aqui.';
  }
  if (!isDefaultMessage(message, property)) return message;
  const label = fieldLabel(path);
  const text = rule(constraint, message, property);
  return label ? `${capitalize(label)}: ${text}.` : `Dado inválido: ${text}.`;
}

// Which of a field's failed rules is worth telling first: what it is before how long it is.
const PRIORITY = ['whitelistValidation', 'isDefined', 'isNotEmpty', 'isString', 'isInt', 'isNumber', 'isIn', 'isEnum', 'isUuid', 'isUUID'];
const rank = (constraint: string) => (PRIORITY.includes(constraint) ? PRIORITY.indexOf(constraint) : PRIORITY.length);

// One sentence per field: a missing field is "obrigatório" (not three complaints about its length
// and type), otherwise the most telling rule it broke.
export function translateValidationErrors(errors: ValidationError[], parent = ''): FieldProblem[] {
  const problems: FieldProblem[] = [];
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const constraints = Object.entries(error.constraints ?? {}).sort(([a], [b]) => rank(a) - rank(b));
    if (constraints.length) {
      const missing = error.value === undefined || error.value === null || error.value === '';
      const [constraint, message] = constraints[0];
      const label = fieldLabel(path);
      problems.push({
        field: path,
        message:
          missing && constraint !== 'whitelistValidation' && isDefaultMessage(message, error.property)
            ? label
              ? `${capitalize(label)}: campo obrigatório.`
              : 'Falta um dado obrigatório.'
            : sentence(path, constraint, message, error.property),
      });
    }
    if (error.children?.length) problems.push(...translateValidationErrors(error.children, path));
  }
  return problems;
}

// What the client gets: the first problems as one readable sentence, every problem in `details`.
export function validationException(errors: ValidationError[]): BadRequestException {
  const details = translateValidationErrors(errors);
  const distinct = [...new Set(details.map((d) => d.message))];
  const shown = distinct.slice(0, 3).join(' ');
  return new BadRequestException({
    code: 'VALIDATION_ERROR',
    message: (distinct.length > 3 ? `${shown} (e mais ${distinct.length - 3}).` : shown) || 'Dados inválidos.',
    details,
  });
}
