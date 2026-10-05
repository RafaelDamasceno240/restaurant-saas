import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_INSTALLMENTS, MAX_RECEIVABLE_CENTS } from '../receivable-calculations';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]+$/;
const IDEMPOTENCY_MESSAGE = 'idempotencyKey deve conter apenas letras, números, "-" ou "_".';
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// How a debt is paid back: how many monthly installments and when the first one is due
// (a calendar day in the restaurant's time zone). Shared by the sale flows (PDV, table) and
// the manual charge.
export class CreditTermsDto {
  @ApiProperty({ minimum: 1, maximum: MAX_INSTALLMENTS, default: 1 })
  @IsInt()
  @Min(1)
  @Max(MAX_INSTALLMENTS)
  installments!: number;

  @ApiProperty({ example: '2026-11-05', description: 'Primeiro vencimento (YYYY-MM-DD); as demais parcelas vencem mensalmente' })
  @IsString()
  @Matches(DATE_ONLY, { message: 'firstDueDate deve estar no formato YYYY-MM-DD.' })
  firstDueDate!: string;
}

// tenantId never appears in any of these: it comes from the token. Money is integer cents.

export class SetCreditLimitDto {
  @ApiProperty({ minimum: 0, maximum: MAX_RECEIVABLE_CENTS, description: 'Centavos; 0 = cliente sem fiado' })
  @IsInt()
  @Min(0)
  @Max(MAX_RECEIVABLE_CENTS)
  creditLimitCents!: number;
}

// A debt that did not come from a sale of this system (an old balance, an agreed amount).
export class CreateReceivableDto {
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty() @IsUUID() branchId!: string;

  @ApiProperty({ example: 'Saldo anterior do caderno' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  description!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_RECEIVABLE_CENTS }) @IsInt() @Min(1) @Max(MAX_RECEIVABLE_CENTS) totalCents!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_INSTALLMENTS }) @IsInt() @Min(1) @Max(MAX_INSTALLMENTS) installments!: number;

  @ApiProperty({ example: '2026-11-05' })
  @IsString()
  @Matches(DATE_ONLY, { message: 'firstDueDate deve estar no formato YYYY-MM-DD.' })
  firstDueDate!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(IDEMPOTENCY_KEY, { message: IDEMPOTENCY_MESSAGE })
  idempotencyKey!: string;
}

export class RegisterReceivablePaymentDto {
  @ApiProperty({ minimum: 1, description: 'Centavos recebidos agora (pode ser parcial)' })
  @IsInt()
  @Min(1)
  @Max(MAX_RECEIVABLE_CENTS)
  amountCents!: number;

  // Real money only: a debt is never paid "on account".
  @ApiProperty({ enum: ['CASH', 'PIX', 'CARD'] })
  @IsIn(['CASH', 'PIX', 'CARD'])
  method!: 'CASH' | 'PIX' | 'CARD';

  @ApiProperty({ description: 'Unidade onde o dinheiro foi recebido (em dinheiro, o caixa dela precisa estar aberto)' })
  @IsUUID()
  branchId!: string;

  @ApiPropertyOptional({ description: 'Quita esta parcela especificamente; sem ela, paga da mais antiga para a mais nova' })
  @IsOptional()
  @IsUUID()
  installmentId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(IDEMPOTENCY_KEY, { message: IDEMPOTENCY_MESSAGE })
  idempotencyKey!: string;
}

export class ReverseReceivablePaymentDto {
  @ApiProperty({ example: 'Pagamento lançado na conta errada' })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiPropertyOptional({ description: 'Obrigatória para estornar pagamento em dinheiro: unidade cujo caixa aberto devolve o valor' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(IDEMPOTENCY_KEY, { message: IDEMPOTENCY_MESSAGE })
  idempotencyKey!: string;
}

export class CancelReceivableDto {
  @ApiProperty({ example: 'Lançada em duplicidade' })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;
}

export const RECEIVABLE_FILTERS = ['open', 'overdue', 'paid', 'cancelled', 'all'] as const;
export type ReceivableFilter = (typeof RECEIVABLE_FILTERS)[number];

export class ListReceivablesQueryDto {
  @ApiPropertyOptional({ enum: RECEIVABLE_FILTERS, default: 'open' })
  @IsOptional()
  @IsIn(RECEIVABLE_FILTERS)
  status?: ReceivableFilter;

  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ description: 'Restringe a uma unidade (precisa ter acesso a ela)' }) @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({ description: 'Nome ou telefone do cliente, ou descrição (contém)' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
