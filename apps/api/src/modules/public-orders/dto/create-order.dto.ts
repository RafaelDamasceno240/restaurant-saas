import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
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
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfillmentType, PaymentMethod } from '@prisma/client';
import { AllowExtraFields } from '../../../common/decorators/allow-extra-fields.decorator';

export class OrderItemInputDto {
  @ApiProperty() @IsUUID() productId!: string;

  // Quantity cap is a deliberate abuse guard (public, unauthenticated
  // endpoint) — not a business rule about basket size.
  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(50) quantity!: number;
}

export class CustomerInputDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;

  // Deliberately lenient — real-world phone entry varies a lot (country
  // code, spaces, dashes, parentheses). Just enough to catch garbage input.
  @ApiProperty({ example: '11987654321' })
  @IsString()
  @Matches(/^[\d\s()+-]{8,20}$/, { message: 'Telefone em formato inválido.' })
  phone!: string;
}

export class AddressInputDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) street!: string;
  @ApiProperty() @IsString() @MaxLength(20) number!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) complement?: string;
  @ApiProperty() @IsString() @MaxLength(120) neighborhood!: string;
  @ApiProperty() @IsString() @MaxLength(120) city!: string;
  @ApiProperty({ example: 'SP' }) @IsString() @MaxLength(2) state!: string;
  @ApiProperty({ example: '01310-100' })
  @IsString()
  @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP em formato inválido.' })
  zipCode!: string;
}

// Guest/public endpoint: a naive or tampering client may send convenience
// fields alongside each item (e.g. a `priceCents` it displayed, or a
// client-computed `total`). Per spec those must be SILENTLY IGNORED, not
// treated as a hard validation error — StrictValidationPipe still strips
// them before the DTO instance is built, so the service never sees them.
@AllowExtraFields()
export class CreateOrderDto {
  @ApiProperty({ example: 'doce-hamburgueria' })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  restaurantSlug!: string;

  @ApiProperty({ type: [OrderItemInputDto] })
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items!: OrderItemInputDto[];

  @ApiProperty({ type: CustomerInputDto })
  @ValidateNested()
  @Type(() => CustomerInputDto)
  customer!: CustomerInputDto;

  // IsIn, not IsEnum(FulfillmentType): DINE_IN (fatia 10) exists only for
  // table checkout and must never be selectable by a guest.
  @ApiProperty({ enum: [FulfillmentType.DELIVERY, FulfillmentType.PICKUP] })
  @IsIn([FulfillmentType.DELIVERY, FulfillmentType.PICKUP])
  fulfillmentType!: 'DELIVERY' | 'PICKUP';

  // Required only for DELIVERY — enforced here (DTO-level) so a malformed
  // or missing address never even reaches the service for a delivery order;
  // PICKUP orders simply omit it.
  @ApiPropertyOptional({ type: AddressInputDto })
  @ValidateIf((dto: CreateOrderDto) => dto.fulfillmentType === 'DELIVERY')
  @ValidateNested()
  @Type(() => AddressInputDto)
  address?: AddressInputDto;

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  // Delivery instructions, distinct from the order's general `notes`. Only used for DELIVERY.
  @ApiPropertyOptional({ example: 'Portão azul, interfone 204' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  deliveryNotes?: string;

  @ApiPropertyOptional({ example: '6f1c2c1e-6d0e-4f4a-9a57-2f3a0a1b9c11' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'idempotencyKey deve conter apenas letras, números, "-" ou "_".' })
  idempotencyKey?: string;
}
