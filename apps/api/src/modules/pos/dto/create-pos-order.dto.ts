import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';
import { ON_ACCOUNT_DISABLED_MESSAGE, SALE_PAYMENT_METHODS } from '../../../common/util/payment-methods';
import { MAX_UNITS_MESSAGE, MAX_UNITS_PER_PRODUCT } from '../../../common/util/item-quantity.util';

export class PosOrderItemDto {
  @ApiProperty() @IsUUID() productId!: string;

  @ApiProperty({ example: 2, maximum: MAX_UNITS_PER_PRODUCT })
  @IsInt()
  @Min(1)
  @Max(MAX_UNITS_PER_PRODUCT, { message: MAX_UNITS_MESSAGE })
  quantity!: number;
}

// Deliberately minimal — matches the exact payload shape requested: items,
// optional customer identification, and a payment method. No fulfillmentType
// or address: a counter sale is always treated as PICKUP internally (the
// customer is physically at the counter), set by PosOrdersService, never by
// the client. No price/name/subtotal/total fields exist here at all — same
// structural guarantee as the public checkout DTO.
export class CreatePosOrderDto {
  // Fatia 08: the operating branch. Validated server-side against the user's
  // access (BranchAccessService) — never trusted as-is.
  @ApiProperty({ description: 'Unidade onde a venda acontece' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ type: [PosOrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => PosOrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items!: PosOrderItemDto[];

  // Fase 11: optional CRM customer. Validated server-side against the caller's tenant
  // (another tenant's id is "not found"); the order snapshot below is still what the order shows.
  @ApiPropertyOptional({ description: 'Cliente cadastrado (CRM) a vincular ao pedido' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  // Fase 11 (fatia 2): optional coupon CODE. Only the code travels: the discount, limits and
  // eligibility are decided by the server. Needs the coupons.apply permission.
  @ApiPropertyOptional({ example: 'PROMO10' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsString()
  @MaxLength(40)
  couponCode?: string;

  // Fase 11 (fatia 5): cents of the linked customer's cashback balance to spend on this sale.
  // Needs a customerId and the cashback.use permission; the server checks the amount against
  // the real balance and against what the items cost. Never a price or a total.
  @ApiPropertyOptional({ example: 500, description: 'Centavos de cashback do cliente a usar nesta venda' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  cashbackToUseCents?: number;

  @ApiPropertyOptional({ example: 'Cliente balcão' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  customerName?: string;

  @ApiPropertyOptional({ example: '11987654321' })
  @IsOptional()
  @IsString()
  @Matches(/^[\d\s()+-]{8,20}$/, { message: 'Telefone em formato inválido.' })
  customerPhone?: string;

  // Money received now. Fiado (ON_ACCOUNT) is no longer sold (remocao-fiado).
  @ApiProperty({ enum: SALE_PAYMENT_METHODS })
  @IsIn(SALE_PAYMENT_METHODS, { message: ON_ACCOUNT_DISABLED_MESSAGE })
  paymentMethod!: PaymentMethod;

  @ApiPropertyOptional({ example: '6f1c2c1e-6d0e-4f4a-9a57-2f3a0a1b9c11' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'idempotencyKey deve conter apenas letras, números, "-" ou "_".' })
  idempotencyKey?: string;
}
