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

  // null clears it.
  @ApiPropertyOptional({ example: 'Pão brioche, blend 180g, queijo prato', nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  // Recebido/retornado em reais (ex.: 24.9) — convertido para centavos
  // (inteiro) na camada de serviço antes de tocar o banco. Nunca fazemos
  // aritmética monetária em float; a conversão é o único ponto de contato.
  // B6 (piloto 2026-10-23): a product for R$ 0,00 showed up on the public menu for free, so the
  // price is at least one cent (create and update alike; UpdateProductDto inherits this).
  @ApiProperty({ example: 24.9, minimum: 0.01, description: 'Preço em reais, até 2 casas decimais, mínimo R$ 0,01' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: PRICE_MESSAGE })
  @Min(0.01, { message: PRICE_MESSAGE })
  price!: number;

  // Promotion: the full price shown struck through ("de R$ 35 por R$ 32"). Must be above the
  // price that is charged (checked against the final values in the service, and by the database
  // CHECK). null removes the promotion.
  @ApiPropertyOptional({ example: 35, nullable: true, description: 'Preço "de" (riscado), em reais; null remove' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Informe o preço "de" com até 2 casas decimais.' })
  @Min(0.01, { message: 'Informe o preço "de" com até 2 casas decimais.' })
  compareAtPrice?: number | null;

  // Shown on the public menu, but cannot be ordered ("Esgotado"). active = false hides it instead.
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  soldOut?: boolean;

  // Listed again in the highlights strip at the top of the public menu.
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  // A pasted link to an image hosted elsewhere. An uploaded photo (PUT /products/:id/photo) wins
  // over it; null clears it.
  @ApiPropertyOptional({ example: 'https://exemplo.com/imagens/x-burger.jpg', nullable: true })
  @IsOptional()
  @IsUrl()
  imageUrl?: string | null;

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
