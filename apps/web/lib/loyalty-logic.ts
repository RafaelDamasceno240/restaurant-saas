import type { BadgeTone } from '@/components/ds/Badge';
import type { LoyaltyEntry, LoyaltyEntryType, LoyaltyReward } from './loyalty-api';

// Presentation and form rules for loyalty points. The API is the authority (it recalculates and
// validates everything); these only give fast feedback and readable output.

export const MAX_POINTS_PER_REAL = 1000;
export const MAX_REWARD_COST = 1_000_000;
export const MAX_ADJUSTMENT_POINTS = 1_000_000;
export const MIN_REASON = 3;
export const MAX_REASON = 200;

export const LOYALTY_ENTRY_LABEL: Record<LoyaltyEntryType, string> = {
  EARN: 'Compra',
  REDEEM: 'Resgate',
  ADJUSTMENT: 'Ajuste',
  REVERSAL: 'Estorno',
};

export const LOYALTY_ENTRY_TONE: Record<LoyaltyEntryType, BadgeTone> = {
  EARN: 'success',
  REDEEM: 'brand',
  ADJUSTMENT: 'info',
  REVERSAL: 'warning',
};

export function formatPoints(points: number): string {
  const text = Math.abs(points).toLocaleString('pt-BR');
  return `${text} ${Math.abs(points) === 1 ? 'ponto' : 'pontos'}`;
}

// "+25" / "−40": the sign is part of what the user reads in a statement.
export function formatSignedPoints(points: number): string {
  return `${points > 0 ? '+' : '−'}${Math.abs(points).toLocaleString('pt-BR')}`;
}

// What the movement was about, in one line.
export function describeEntry(entry: Pick<LoyaltyEntry, 'type' | 'orderNumber' | 'reward' | 'reason'>): string {
  switch (entry.type) {
    case 'EARN':
      return entry.orderNumber ? `Pedido ${entry.orderNumber}` : 'Pedido';
    case 'REDEEM':
      return entry.reward?.name ?? 'Recompensa';
    case 'ADJUSTMENT':
      return entry.reason ?? 'Ajuste manual';
    case 'REVERSAL':
      return entry.reason ?? 'Estorno';
  }
}

// "R$ 1,00 = 2 pontos".
export function describeRate(pointsPerReal: number): string {
  return `R$ 1,00 = ${pointsPerReal} ${pointsPerReal === 1 ? 'ponto' : 'pontos'}`;
}

// Only whole positive numbers; '' and anything else is null.
export function parsePositiveInt(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function validateProgram(pointsPerRealText: string): string | null {
  const value = parsePositiveInt(pointsPerRealText);
  if (value === null || value > MAX_POINTS_PER_REAL) return `Informe de 1 a ${MAX_POINTS_PER_REAL} pontos por real.`;
  return null;
}

export interface RewardDraft {
  name: string;
  description: string;
  pointsCost: string;
}

export const EMPTY_REWARD: RewardDraft = { name: '', description: '', pointsCost: '' };

export function toRewardDraft(reward: LoyaltyReward): RewardDraft {
  return { name: reward.name, description: reward.description ?? '', pointsCost: String(reward.pointsCost) };
}

export function validateReward(draft: RewardDraft): string | null {
  if (draft.name.trim().length < 2) return 'Informe o nome da recompensa (mínimo 2 caracteres).';
  if (draft.name.trim().length > 80) return 'O nome aceita até 80 caracteres.';
  if (draft.description.trim().length > 200) return 'A descrição aceita até 200 caracteres.';
  const cost = parsePositiveInt(draft.pointsCost);
  if (cost === null || cost > MAX_REWARD_COST) return 'Informe o custo em pontos (número inteiro, a partir de 1).';
  return null;
}

export type AdjustDirection = 'credit' | 'debit';

export interface AdjustDraft {
  direction: AdjustDirection;
  points: string;
  reason: string;
}

export const EMPTY_ADJUST: AdjustDraft = { direction: 'credit', points: '', reason: '' };

// A debit larger than the balance is refused here for a fast answer; the API refuses it too,
// against the balance at that instant.
export function validateAdjust(draft: AdjustDraft, balancePoints: number): string | null {
  const points = parsePositiveInt(draft.points);
  if (points === null || points > MAX_ADJUSTMENT_POINTS) return 'Informe a quantidade de pontos (número inteiro, a partir de 1).';
  if (draft.direction === 'debit' && points > balancePoints) return `O cliente tem apenas ${formatPoints(balancePoints)}.`;
  return validateReason(draft.reason);
}

export function validateReason(reason: string): string | null {
  const text = reason.trim();
  if (text.length < MIN_REASON) return `Informe o motivo (mínimo ${MIN_REASON} caracteres).`;
  if (text.length > MAX_REASON) return `O motivo aceita até ${MAX_REASON} caracteres.`;
  return null;
}

// Signed value sent to the API: a debit is negative.
export function adjustPoints(draft: AdjustDraft): number {
  const points = parsePositiveInt(draft.points) ?? 0;
  return draft.direction === 'debit' ? -points : points;
}

// Rewards the customer can afford right now come first; the screen disables the others.
export function canAfford(reward: Pick<LoyaltyReward, 'pointsCost'>, balancePoints: number): boolean {
  return reward.pointsCost <= balancePoints;
}

export function isReversible(entry: Pick<LoyaltyEntry, 'type' | 'reversed'>): boolean {
  return entry.type !== 'REVERSAL' && !entry.reversed;
}

// Friendly text for the API error codes of these screens; unknown codes keep the API message.
export function loyaltyErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'LOYALTY_INSUFFICIENT_POINTS':
      return 'Saldo de pontos insuficiente para esta operação.';
    case 'LOYALTY_DISABLED':
      return 'O programa de fidelidade está desativado.';
    case 'LOYALTY_REWARD_INACTIVE':
      return 'Esta recompensa está inativa.';
    case 'LOYALTY_REWARD_NOT_FOUND':
      return 'Recompensa não encontrada. Atualize a lista.';
    case 'LOYALTY_ENTRY_ALREADY_REVERSED':
      return 'Esta movimentação já foi estornada.';
    case 'LOYALTY_ENTRY_NOT_REVERSIBLE':
      return 'Um estorno não pode ser estornado.';
    case 'CUSTOMER_INACTIVE':
      return 'Este cliente está inativo.';
    case 'BRANCH_ACCESS_DENIED':
      return 'Você não tem acesso a esta unidade.';
    default:
      return fallback;
  }
}
