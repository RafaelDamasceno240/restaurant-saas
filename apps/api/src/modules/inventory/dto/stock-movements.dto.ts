import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
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
import { StockExitReason, StockMovementOrigin, StockMovementType } from '@prisma/client';
import { MAX_QUANTITY, MAX_UNIT_COST_CENTS, MIN_POSITIVE_QUANTITY, QUANTITY_DECIMALS } from './inventory-limits';

export const MANUAL_MOVEMENT_TYPES = ['ENTRY', 'EXIT'] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

const isEntry = (dto: CreateStockMovementDto) => dto.type === 'ENTRY';
const isExit = (dto: CreateStockMovementDto) => dto.type === 'EXIT';

export class CreateStockMovementDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsUUID() inventoryItemId!: string;

  @ApiProperty({ enum: MANUAL_MOVEMENT_TYPES })
  @IsIn(MANUAL_MOVEMENT_TYPES)
  type!: ManualMovementType;

  @ApiProperty({ example: 2.5 })
  @IsNumber(QUANTITY_DECIMALS)
  @Min(MIN_POSITIVE_QUANTITY)
  @Max(MAX_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({ example: 3290, description: 'ENTRY: centavos por unidade de estoque' })
  @ValidateIf((dto: CreateStockMovementDto) => isEntry(dto) || dto.unitCostCents !== undefined)
  @IsInt()
  @Min(0)
  @Max(MAX_UNIT_COST_CENTS)
  unitCostCents?: number;

  @ApiPropertyOptional({ enum: StockExitReason, description: 'Obrigatório para EXIT' })
  @ValidateIf((dto: CreateStockMovementDto) => isExit(dto) || dto.exitReason !== undefined)
  @IsEnum(StockExitReason)
  exitReason?: StockExitReason;

  @ApiPropertyOptional({ description: 'Obrigatória para EXIT com motivo OTHER' })
  @ValidateIf((dto: CreateStockMovementDto) => dto.exitReason === 'OTHER' || dto.notes !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  notes?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) supplierName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) documentNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) lotCode?: string;

  @ApiPropertyOptional({ example: '2026-10-15' })
  @IsOptional()
  @IsDateString({ strict: true })
  expiresAt?: string;
}

export class ListStockMovementsQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiPropertyOptional({ enum: StockMovementType }) @IsOptional() @IsEnum(StockMovementType) type?: StockMovementType;
  @ApiPropertyOptional({ enum: StockMovementOrigin }) @IsOptional() @IsEnum(StockMovementOrigin) origin?: StockMovementOrigin;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inventoryItemId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() createdByUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}
