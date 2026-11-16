// Pure helpers of the menu administration screens (products, add-ons, look of the restaurant).
// No React and no fetch, so all of it is unit-tested. The API checks every rule again: these only
// let the screen say what is wrong before sending.
import { toCents } from './money';

// ---------------------------------------------------------------------------------------------
// Ordering (the up/down buttons send the whole new order of the list)
// ---------------------------------------------------------------------------------------------

export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// ---------------------------------------------------------------------------------------------
// Prices typed in the forms ("12,5", "12.50", "")
// ---------------------------------------------------------------------------------------------

export function parseMoney(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

const twoDecimals = (value: number) => Math.abs(value * 100 - toCents(value)) <= 1e-6;

// The promotion ("de R$ 35 por R$ 32"): optional, but when given it must be above the price.
export function promoPriceProblem(priceText: string, compareText: string): string | null {
  if (compareText.trim() === '') return null;
  const compare = parseMoney(compareText);
  if (compare === null || compare <= 0 || !twoDecimals(compare))
    return 'Informe o preço "de" em reais, com até 2 casas decimais.';
  const price = parseMoney(priceText);
  if (price !== null && toCents(compare) <= toCents(price))
    return 'O preço "de" (riscado) precisa ser maior que o preço de venda.';
  return null;
}

// An add-on may be free (0), never negative.
export function optionPriceProblem(text: string): string | null {
  const value = parseMoney(text);
  if (value === null || value < 0 || !twoDecimals(value))
    return 'Informe o preço do adicional em reais, com até 2 casas decimais (0 = grátis).';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Add-on groups
// ---------------------------------------------------------------------------------------------

export const MAX_SELECT_LIMIT = 50;

export function groupRangeProblem(minSelect: number, maxSelect: number): string | null {
  if (!Number.isInteger(minSelect) || minSelect < 0) return 'O mínimo não pode ser negativo.';
  if (!Number.isInteger(maxSelect) || maxSelect < 1 || maxSelect > MAX_SELECT_LIMIT)
    return `O máximo deve ficar entre 1 e ${MAX_SELECT_LIMIT}.`;
  if (minSelect > maxSelect) return 'O mínimo não pode ser maior que o máximo.';
  return null;
}

// How the rule reads in the panel: "Opcional · até 3" / "Obrigatório · escolha 1".
export function groupRuleLabel(minSelect: number, maxSelect: number): string {
  if (minSelect === 0) return `Opcional · até ${maxSelect}`;
  if (minSelect === maxSelect) return `Obrigatório · escolha ${minSelect}`;
  return `Obrigatório · de ${minSelect} a ${maxSelect}`;
}

// ---------------------------------------------------------------------------------------------
// Images (the API decides by the file's bytes; this only spares a useless upload)
// ---------------------------------------------------------------------------------------------

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function imageFileProblem(file: { size: number; type: string }): string | null {
  if (file.type && !IMAGE_TYPES.includes(file.type)) return 'Use uma imagem JPEG, PNG ou WebP.';
  if (file.size > MAX_IMAGE_BYTES)
    return 'A imagem passa de 3 MB. Reduza o tamanho e tente de novo.';
  if (file.size === 0) return 'O arquivo está vazio.';
  return null;
}

// ---------------------------------------------------------------------------------------------
// Brand color
// ---------------------------------------------------------------------------------------------

export function normalizeHexColor(text: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return m ? `#${m[1].toUpperCase()}` : null;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

// Contrast of the color against the white page of the menu (WCAG ratio, 1 to 21). The text on
// buttons is already picked white or dark to read well (brandCssVars); what can fail is the color
// itself standing out from the page.
export function contrastOnWhite(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

export function brandColorWarning(hex: string | null): string | null {
  if (!hex) return null;
  return contrastOnWhite(hex) < 3
    ? 'Cor muito clara: botões e destaques vão aparecer pouco no fundo branco do cardápio.'
    : null;
}
