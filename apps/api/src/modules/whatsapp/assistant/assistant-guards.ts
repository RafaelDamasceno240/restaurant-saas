// Deterministic rules around the assistant. They do not depend on the AI provider, so a model
// that is tricked by a message ("ignore your instructions...") still cannot get past them:
// - a price in a reply must be a price the catalogue or the cart returned in this turn;
// - a link in a reply must point at this platform's web app;
// - the checkout link only comes after the customer said "sim" to the summary they saw;
// - "atendente" and "parar" are honoured without asking the model.

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasPhrase(text: string, phrases: string[]): boolean {
  const padded = ` ${normalize(text)} `;
  return phrases.some((p) => padded.includes(` ${p} `));
}

const HANDOFF = [
  'atendente',
  'humano',
  'humana',
  'pessoa',
  'falar com alguem',
  'falar com uma pessoa',
  'falar com o gerente',
  'gerente',
  'reclamacao',
];

export function wantsHuman(text: string): boolean {
  return hasPhrase(text, HANDOFF);
}

const OPT_OUT = [
  'parar',
  'pare',
  'sair',
  'descadastrar',
  'nao quero receber',
  'cancelar mensagens',
];

export function wantsOptOut(text: string): boolean {
  const n = normalize(text);
  // Only the whole message: "quero parar de comer bacon" is not an opt-out.
  return OPT_OUT.includes(n);
}

const YES = [
  'sim',
  's',
  'ss',
  'isso',
  'isso mesmo',
  'confirmo',
  'confirmar',
  'confirmado',
  'pode',
  'pode sim',
  'pode gerar',
  'pode mandar',
  'manda',
  'ok',
  'okay',
  'certo',
  'fechado',
  'beleza',
  'perfeito',
  'sim por favor',
  'sim pode',
  'gera o link',
  'manda o link',
];

// The customer's answer to "Posso gerar o link?". Only short, unambiguous answers count: a
// message that also asks for something else is not a confirmation.
export function isAffirmative(text: string): boolean {
  const n = normalize(text).replace(/\s*#\s*/g, ' ');
  if (n.length === 0 || n.length > 40) return false;
  return (
    YES.includes(n) ||
    /^(sim|isso|pode|ok|confirmo)( (sim|isso|pode|obrigad[oa]|por favor|confirmo|pode gerar|pode mandar))*$/.test(
      n,
    )
  );
}

export function isNegative(text: string): boolean {
  const n = normalize(text);
  return [
    'nao',
    'n',
    'ainda nao',
    'nao obrigado',
    'nao obrigada',
    'espera',
    'calma',
    'mudar',
  ].includes(n);
}

// "R$ 26,00", "R$26", "26,90 reais" -> cents. Used only to CHECK a reply, never to price.
export function pricesInText(text: string): number[] {
  const found: number[] = [];
  const re =
    /R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{1,2}))?|\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s?reais/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const whole = (m[1] ?? m[3]).replace(/\./g, '');
    const fraction = (m[2] ?? m[4] ?? '0').padEnd(2, '0');
    found.push(Number(whole) * 100 + Number(fraction));
  }
  return found;
}

export function unverifiedPrices(text: string, allowedCents: Set<number>): number[] {
  return pricesInText(text).filter((cents) => !allowedCents.has(cents));
}

// Links other than the web app's are removed; the reply keeps its text.
export function stripForeignLinks(text: string, allowedBase: string): string {
  return text.replace(/\bhttps?:\/\/[^\s)]+/gi, (url) =>
    url.startsWith(`${allowedBase}/`) ? url : '[link removido]',
  );
}

export function formatCents(cents: number): string {
  const reais = Math.floor(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100).padStart(2, '0');
  const withDots = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0 ? '-' : ''}R$ ${withDots},${rest}`;
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
};

export function numberWord(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  if (/^\d{1,2}x$/.test(token)) return Number(token.slice(0, -1));
  return NUMBER_WORDS[token] ?? null;
}
