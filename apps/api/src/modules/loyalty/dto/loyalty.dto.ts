import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
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
  NotEquals,
} from 'class-validator';
import { MAX_ADJUSTMENT_POINTS, MAX_POINTS_PER_REAL } from '../loyalty-calculations';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => {
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' ? null : text;
};

// Same shape as the other client-generated keys of the API (table checkout, orders).
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]+$/;
const IDEMPOTENCY_MESSAGE = 'idempotencyKey deve conter apenas letras, números, "-" ou "_".';

// tenantId never appears in any of these: it comes from the token.

export class UpdateLoyaltyProgramDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;

  @ApiProperty({ minimum: 1, maximum: MAX_POINTS_PER_REAL, description: 'Pontos por R$ 1,00 pago nos itens' })
  @IsInt()
  @Min(1)
  @Max(MAX_POINTS_PER_REAL)
  pointsPerReal!: number;
}

export class CreateLoyaltyRewardDto {
  @ApiProperty({ example: 'Sobremesa da casa' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(200) description?: string | null;

  @ApiProperty({ minimum: 1, maximum: 1_000_000 }) @IsInt() @Min(1) @Max(1_000_000) pointsCost!: number;
}

export class UpdateLoyaltyRewardDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(200) description?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) pointsCost?: number;
  @ApiPropertyOptional({ description: 'false desativa; true reativa' }) @IsOptional() @IsBoolean() active?: boolean;
}

export class ListLoyaltyRewardsQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}

// The reward decides how many points leave the account; the client never sends a number.
export class RedeemLoyaltyRewardDto {
  @ApiProperty() @IsUUID() rewardId!: string;

  @ApiProperty({ description: 'Unidade onde o resgate acontece (precisa ter acesso a ela)' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: '6f1c2c1e-6d0e-4f4a-9a57-2f3a0a1b9c11' })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(IDEMPOTENCY_KEY, { message: IDEMPOTENCY_MESSAGE })
  idempotencyKey!: string;
}

export class AdjustLoyaltyPointsDto {
  @ApiProperty({ description: 'Positivo credita, negativo debita; nunca zero' })
  @IsInt()
  @NotEquals(0)
  @Min(-MAX_ADJUSTMENT_POINTS)
  @Max(MAX_ADJUSTMENT_POINTS)
  points!: number;

  @ApiProperty({ example: 'Cortesia pelo atraso na entrega' })
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

export class ReverseLoyaltyEntryDto {
  @ApiProperty({ example: 'Resgate lançado no cliente errado' })
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

export class ListLoyaltyEntriesQueryDto {
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
