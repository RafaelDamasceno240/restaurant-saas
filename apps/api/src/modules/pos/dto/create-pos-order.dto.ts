import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEnum,
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
import { PaymentMethod } from '@prisma/client';

export class PosOrderItemDto {
  @ApiProperty() @IsUUID() productId!: string;

  @ApiProperty({ example: 2 }) @IsInt() @Min(1) @Max(50) quantity!: number;
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

  @ApiProperty({ enum: PaymentMethod })
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
}
