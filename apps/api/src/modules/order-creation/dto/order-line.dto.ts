import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_UNITS_MESSAGE, MAX_UNITS_PER_PRODUCT } from '../../../common/util/item-quantity.util';

// The note of one order line ("sem cebola"), the same limit as the public checkout.
export const ORDER_LINE_NOTE_MAX = 140;

// One add-on chosen for EACH unit of a line. Only the id and how many: the price, the group and
// whether it belongs to this product at all are decided by the server (option-pricing.ts). Shared
// by the public checkout, the PDV, the coupon previews, the quote and the table rounds.
export class OrderLineOptionDto {
  @ApiProperty() @IsUUID() optionId!: string;

  @ApiProperty({ example: 1, maximum: 50 }) @IsInt() @Min(1) @Max(50) quantity!: number;
}

// One line of a staff sale (PDV): the product, how many, its add-ons and its note. No price or
// name field exists here at all - the server reads the product and its options itself.
export class StaffOrderLineDto {
  @ApiProperty() @IsUUID() productId!: string;

  @ApiProperty({ example: 2, maximum: MAX_UNITS_PER_PRODUCT })
  @IsInt()
  @Min(1)
  @Max(MAX_UNITS_PER_PRODUCT, { message: MAX_UNITS_MESSAGE })
  quantity!: number;

  @ApiPropertyOptional({ type: [OrderLineOptionDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OrderLineOptionDto)
  @ArrayMaxSize(50)
  options?: OrderLineOptionDto[];

  @ApiPropertyOptional({ example: 'Sem cebola' })
  @IsOptional()
  @IsString()
  @MaxLength(ORDER_LINE_NOTE_MAX)
  notes?: string;
}

// Body of POST /pos/orders/quote: what this basket costs right now, priced by the server.
export class QuoteItemsDto {
  @ApiProperty({ type: [StaffOrderLineDto] })
  @ValidateNested({ each: true })
  @Type(() => StaffOrderLineDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  items!: StaffOrderLineDto[];
}
