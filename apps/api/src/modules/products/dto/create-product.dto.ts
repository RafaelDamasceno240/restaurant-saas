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

const PRICE_MESSAGE = 'Informe um preço de pelo menos R$ 0,01, com até 2 casas decimais.';

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
  // B6 (piloto 2026-10-23): a product for R$ 0,00 showed up on the public menu for free, so the
  // price is at least one cent (create and update alike; UpdateProductDto inherits this).
  @ApiProperty({ example: 24.9, minimum: 0.01, description: 'Preço em reais, até 2 casas decimais, mínimo R$ 0,01' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: PRICE_MESSAGE })
  @Min(0.01, { message: PRICE_MESSAGE })
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
