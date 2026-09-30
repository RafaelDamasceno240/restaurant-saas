import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PurchaseStatus } from '@prisma/client';
import {
  MAX_QUANTITY,
  MAX_UNIT_COST_CENTS,
  MIN_POSITIVE_QUANTITY,
  QUANTITY_DECIMALS,
} from '../../inventory/dto/inventory-limits';

export const MAX_PURCHASE_ITEMS = 100;
export const MAX_ADJUSTMENT_CENTS = 1_000_000_000;

export class PurchaseItemInputDto {
  @ApiProperty() @IsUUID() inventoryItemId!: string;

  @ApiProperty({ example: 12.5 })
  @IsNumber(QUANTITY_DECIMALS)
  @Min(MIN_POSITIVE_QUANTITY)
  @Max(MAX_QUANTITY)
  quantity!: number;

  @ApiProperty({ example: 3200, description: 'Centavos por unidade de estoque do insumo' })
  @IsInt()
  @Min(0)
  @Max(MAX_UNIT_COST_CENTS)
  unitCostCents!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) lotCode?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string;
}

export class CreatePurchaseDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsUUID() supplierId!: string;

  @ApiProperty({ example: '2026-10-01' })
  @IsDateString({ strict: true })
  purchaseDate!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;

  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(MAX_ADJUSTMENT_CENTS) discountCents?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(MAX_ADJUSTMENT_CENTS) freightCents?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(MAX_ADJUSTMENT_CENTS) otherCostsCents?: number;

  @ApiProperty({ type: [PurchaseItemInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PURCHASE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items!: PurchaseItemInputDto[];

  @ApiPropertyOptional({ description: 'Cria e recebe a compra na mesma transação' })
  @IsOptional()
  @IsBoolean()
  receiveNow?: boolean;
}

export class UpdatePurchaseDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) purchaseDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_ADJUSTMENT_CENTS) discountCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_ADJUSTMENT_CENTS) freightCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(MAX_ADJUSTMENT_CENTS) otherCostsCents?: number;

  @ApiPropertyOptional({ type: [PurchaseItemInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PURCHASE_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items?: PurchaseItemInputDto[];
}

export class CancelPurchaseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(300) reason?: string;
}

export class ListPurchasesQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiPropertyOptional({ enum: PurchaseStatus }) @IsOptional() @IsEnum(PurchaseStatus) status?: PurchaseStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @IsDateString({ strict: true }) dateFrom?: string;
  @ApiPropertyOptional({ example: '2026-10-31' }) @IsOptional() @IsDateString({ strict: true }) dateTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
