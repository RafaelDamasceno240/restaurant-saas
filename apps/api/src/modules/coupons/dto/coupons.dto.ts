import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CouponDiscountType } from '@prisma/client';
import { MAX_AMOUNT_CENTS } from '../coupon-calculations';
import { COUPON_CODE_PATTERN, normalizeCouponCode } from '../coupon-input';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const blankToNull = ({ value }: { value: unknown }) => {
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' ? null : text;
};
// The canonical form is produced BEFORE validation, so " promo10 " is accepted as PROMO10,
// while "PRO MO" still fails the pattern.
const canonicalCode = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normalizeCouponCode(value) : value;
// "" and null clear an optional date/number on update.
const emptyToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class CreateCouponDto {
  @ApiProperty({
    example: 'PROMO10',
    description: 'Normalizado: sem espaços nas pontas, em maiúsculas; A-Z, 0-9, - e _ (3 a 32).',
  })
  @Transform(canonicalCode)
  @IsString()
  @Matches(COUPON_CODE_PATTERN, {
    message: 'Código inválido: use de 3 a 32 caracteres entre letras, números, "-" e "_".',
  })
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(200)
  description?: string | null;

  @ApiProperty({ enum: CouponDiscountType })
  @IsEnum(CouponDiscountType)
  discountType!: CouponDiscountType;

  @ApiProperty({ description: 'PERCENTAGE: percentual inteiro (1-100). FIXED: centavos.' })
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  value!: number;

  @ApiPropertyOptional({
    description: 'Subtotal mínimo dos itens, em centavos (antes do desconto).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  minOrderCents?: number;

  @ApiPropertyOptional({ description: 'Somente PERCENTAGE: teto do desconto, em centavos.' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  maxDiscountCents?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @Type(() => Date)
  @IsDate()
  startsAt?: Date | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @Type(() => Date)
  @IsDate()
  endsAt?: Date | null;

  @ApiPropertyOptional({ description: 'Limite global de utilizações (pedidos).' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  usageLimit?: number | null;

  @ApiPropertyOptional({ description: 'Exige cliente cadastrado vinculado ao pedido (PDV).' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  perCustomerLimit?: number | null;

  @ApiPropertyOptional({ description: 'Restringe a uma unidade; omitido = todas as unidades.' })
  @IsOptional()
  @Transform(emptyToNull)
  @IsUUID()
  branchId?: string | null;
}

// Only what may change after creation. `code`, `branchId` and `active` are deliberately absent:
// the code is the coupon's identity (orders keep it as a snapshot), the branch scope is part of
// who may manage it, and activation has its own endpoints (separate audit events).
// forbidNonWhitelisted rejects them with 400, as it does for tenantId.
export class UpdateCouponDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(200)
  description?: string | null;
  @ApiPropertyOptional({ enum: CouponDiscountType })
  @IsOptional()
  @IsEnum(CouponDiscountType)
  discountType?: CouponDiscountType;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(MAX_AMOUNT_CENTS) value?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  minOrderCents?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  maxDiscountCents?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @Type(() => Date)
  @IsDate()
  startsAt?: Date | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @Type(() => Date)
  @IsDate()
  endsAt?: Date | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  usageLimit?: number | null;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(emptyToNull)
  @IsInt()
  @Min(1)
  @Max(MAX_AMOUNT_CENTS)
  perCustomerLimit?: number | null;
}

export type CouponStatusFilter = 'active' | 'inactive' | 'all';

export class ListCouponsQueryDto {
  @ApiPropertyOptional({ description: 'Código (contém, sem diferenciar maiúsculas)' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(40)
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: CouponStatusFilter;

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

// ---- preview (read-only) ---------------------------------------------------------------

export class PreviewItemDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(50) quantity!: number;
}

// Body of the PDV preview. Prices are NEVER part of it: the server prices the items.
export class PosCouponPreviewDto {
  @ApiProperty() @IsUUID() branchId!: string;

  @ApiProperty({ type: [PreviewItemDto] })
  @ValidateNested({ each: true })
  @Type(() => PreviewItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items!: PreviewItemDto[];

  @ApiProperty({ example: 'PROMO10' })
  @Transform(canonicalCode)
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiPropertyOptional({ description: 'Cliente cadastrado (CRM); validado no tenant e ativo.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;
}
