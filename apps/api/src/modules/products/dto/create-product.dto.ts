import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @ApiProperty({ description: 'ID da categoria — deve pertencer ao mesmo tenant' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ example: 'X-Burger Artesanal' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ example: 'Pão brioche, blend 180g, queijo prato' })
  @IsOptional()
  @IsString()
  description?: string;

  // Recebido/retornado em reais (ex.: 24.9) — convertido para centavos
  // (inteiro) na camada de serviço antes de tocar o banco. Nunca fazemos
  // aritmética monetária em float; a conversão é o único ponto de contato.
  @ApiProperty({ example: 24.9, description: 'Preço em reais, até 2 casas decimais' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ example: 'https://exemplo.com/imagens/x-burger.jpg' })
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  displayOrder?: number;
}
