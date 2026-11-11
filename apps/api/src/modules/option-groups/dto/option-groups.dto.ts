import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_SELECT_LIMIT } from '../option-group-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

// A group of add-ons ("Turbine seu lanche!", "Escolha o refrigerante"). minSelect > 0 makes it
// required; maxSelect is the most units the customer may pick in it, all options together.
export class CreateOptionGroupDto {
  @ApiProperty({ example: 'Turbine seu lanche!' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Informe o nome do grupo.' })
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 0, description: '0 = opcional; 1 ou mais = obrigatório' })
  @IsInt()
  @Min(0)
  @Max(MAX_SELECT_LIMIT)
  minSelect!: number;

  @ApiProperty({ example: 3 })
  @IsInt()
  @Min(1)
  @Max(MAX_SELECT_LIMIT)
  maxSelect!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateOptionGroupDto extends PartialType(CreateOptionGroupDto) {}

// One add-on of a group. The price is added to the product for each unit chosen (0 = free).
export class CreateOptionItemDto {
  @ApiProperty({ example: 'Bacon' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Informe o nome do adicional.' })
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @ApiProperty({ example: 4, description: 'Preço em reais (0 = grátis)' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'Informe o preço do adicional em reais, com até 2 casas decimais (0 = grátis).' },
  )
  @Min(0, { message: 'O preço do adicional não pode ser negativo.' })
  @Max(10000)
  price!: number;

  @ApiPropertyOptional({ default: 1, description: 'Quantas unidades deste adicional por produto' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SELECT_LIMIT)
  maxQuantity?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  soldOut?: boolean;
}

export class UpdateOptionItemDto extends PartialType(CreateOptionItemDto) {}

// The products that offer this group. Replaces the whole list; a product keeps the position of
// its other groups, and a group added to it goes last.
export class SetGroupProductsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique({ message: 'O mesmo produto foi enviado duas vezes.' })
  @IsUUID('4', { each: true })
  productIds!: string[];
}

// The new order of every option of the group (the first id is shown first).
export class ReorderOptionsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique({ message: 'O mesmo adicional foi enviado duas vezes.' })
  @IsUUID('4', { each: true })
  optionIds!: string[];
}
