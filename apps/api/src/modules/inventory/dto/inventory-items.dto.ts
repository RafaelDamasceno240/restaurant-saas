import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { InventoryUnit } from '@prisma/client';
import { MAX_QUANTITY, QUANTITY_DECIMALS } from './inventory-limits';

export class CreateInventoryItemDto {
  @ApiProperty({ example: 'Queijo cheddar' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 'QJ-CHED' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  sku?: string;

  @ApiProperty({ enum: InventoryUnit })
  @IsEnum(InventoryUnit)
  unit!: InventoryUnit;

  @ApiPropertyOptional({ example: 2, default: 0 })
  @IsOptional()
  @IsNumber(QUANTITY_DECIMALS)
  @Min(0)
  @Max(MAX_QUANTITY)
  minStock?: number;

  @ApiPropertyOptional({ example: 20, nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber(QUANTITY_DECIMALS)
  @Min(0)
  @Max(MAX_QUANTITY)
  maxStock?: number | null;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  tracksExpiry?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateInventoryItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(60)
  sku?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber(QUANTITY_DECIMALS)
  @Min(0)
  @Max(MAX_QUANTITY)
  minStock?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsNumber(QUANTITY_DECIMALS)
  @Min(0)
  @Max(MAX_QUANTITY)
  maxStock?: number | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() tracksExpiry?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_dto, value) => value !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export const ITEM_STATUS_FILTERS = ['OK', 'LOW_STOCK', 'OUT_OF_STOCK', 'INACTIVE'] as const;
export type ItemStatusFilter = (typeof ITEM_STATUS_FILTERS)[number];

export class ListInventoryItemsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;

  @ApiPropertyOptional({ enum: ITEM_STATUS_FILTERS })
  @IsOptional()
  @IsIn(ITEM_STATUS_FILTERS)
  status?: ItemStatusFilter;
}

export class ItemBranchQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
