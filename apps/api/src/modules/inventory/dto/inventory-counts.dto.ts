import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_QUANTITY, QUANTITY_DECIMALS } from './inventory-limits';

export class InventoryCountLineDto {
  @ApiProperty() @IsUUID() inventoryItemId!: string;

  @ApiProperty({ example: 8.5, description: 'Quantidade física contada, na unidade de estoque' })
  @IsNumber(QUANTITY_DECIMALS)
  @Min(0)
  @Max(MAX_QUANTITY)
  countedQuantity!: number;
}

export class CreateInventoryCountDto {
  @ApiProperty() @IsUUID() branchId!: string;

  @ApiPropertyOptional({ example: 'Contagem de fechamento' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;

  @ApiProperty({ type: [InventoryCountLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => InventoryCountLineDto)
  items!: InventoryCountLineDto[];
}
