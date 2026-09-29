import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export const MAX_CASH_AMOUNT_CENTS = 100_000_000; // R$ 1.000.000,00 — sanity cap

export class OpenCashSessionDto {
  @ApiProperty({ description: 'Unidade — validada contra o acesso do usuário' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 10000, description: 'Saldo inicial em centavos (>= 0)' })
  @IsInt()
  @Min(0)
  @Max(MAX_CASH_AMOUNT_CENTS)
  openingBalanceCents!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
