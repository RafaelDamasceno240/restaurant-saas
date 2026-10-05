import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
  ValidateIf,
} from 'class-validator';
import { MAX_ADJUSTMENT_CENTS, MAX_EARN_RATE_BPS, MAX_EXPIRE_AFTER_DAYS } from '../cashback-calculations';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]+$/;
const IDEMPOTENCY_MESSAGE = 'idempotencyKey deve conter apenas letras, números, "-" ou "_".';

// tenantId never appears in any of these: it comes from the token. Money is integer cents.

export class UpdateCashbackProgramDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;

  @ApiProperty({ minimum: 1, maximum: MAX_EARN_RATE_BPS, description: 'Pontos-base: 500 = 5,00% do valor pago nos itens' })
  @IsInt()
  @Min(1)
  @Max(MAX_EARN_RATE_BPS)
  earnRateBps!: number;

  @ApiProperty({
    nullable: true,
    minimum: 1,
    maximum: MAX_EXPIRE_AFTER_DAYS,
    description: 'Dias sem crédito nem uso até o saldo expirar; null = não expira',
  })
  @ValidateIf((dto: UpdateCashbackProgramDto) => dto.expireAfterDays !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_EXPIRE_AFTER_DAYS)
  expireAfterDays!: number | null;
}

export class AdjustCashbackDto {
  @ApiProperty({ description: 'Centavos. Positivo credita, negativo debita; nunca zero' })
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_ADJUSTMENT_CENTS)
  @Max(MAX_ADJUSTMENT_CENTS)
  amountCents!: number;

  @ApiProperty({ example: 'Crédito de cortesia pelo erro no pedido' })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(IDEMPOTENCY_KEY, { message: IDEMPOTENCY_MESSAGE })
  idempotencyKey!: string;
}

export class ReverseCashbackEntryDto {
  @ApiProperty({ example: 'Crédito lançado no cliente errado' })
  @Transform(trimmed)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reason!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(IDEMPOTENCY_KEY, { message: IDEMPOTENCY_MESSAGE })
  idempotencyKey!: string;
}

export class ListCashbackEntriesQueryDto {
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
