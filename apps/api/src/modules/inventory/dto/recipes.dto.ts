import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { InventoryUnit } from '@prisma/client';
import { MAX_QUANTITY, MIN_POSITIVE_QUANTITY, QUANTITY_DECIMALS } from './inventory-limits';

export class RecipeItemInputDto {
  @ApiProperty() @IsUUID() inventoryItemId!: string;

  @ApiProperty({ example: 150, description: 'Consumo por 1 unidade do produto' })
  @IsNumber(QUANTITY_DECIMALS)
  @Min(MIN_POSITIVE_QUANTITY)
  @Max(MAX_QUANTITY)
  quantity!: number;

  @ApiPropertyOptional({ enum: InventoryUnit, description: 'Unidade informada; padrão: a unidade do insumo' })
  @IsOptional()
  @IsEnum(InventoryUnit)
  unit?: InventoryUnit;
}

export class PutRecipeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;

  @ApiProperty({ type: [RecipeItemInputDto], description: 'Lista vazia remove a ficha técnica' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RecipeItemInputDto)
  items!: RecipeItemInputDto[];
}

export class RecipeQueryDto {
  @ApiPropertyOptional({ description: 'Unidade usada para o custo médio' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class RecipeListQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
}
