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
import { MAX_RECEIVABLE_CENTS } from '../receivable-calculations';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]+$/;
const IDEMPOTENCY_MESSAGE = 'idempotencyKey deve conter apenas letras, números, "-" ou "_".';

// tenantId never appears in any of these: it comes from the token. Money is integer cents.
// Fiado is no longer sold (remocao-fiado): only what settles the debts that already exist.

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
