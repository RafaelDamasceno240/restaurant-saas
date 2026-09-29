import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { MAX_CASH_AMOUNT_CENTS } from './open-session.dto';

// SALE is deliberately NOT accepted here: sale movements are generated only
// by the backend, atomically with the PDV order (see CashRegisterService).
export const MANUAL_MOVEMENT_TYPES = ['SUPPLY', 'WITHDRAWAL'] as const;
export type ManualMovementType = (typeof MANUAL_MOVEMENT_TYPES)[number];

export class CreateCashMovementDto {
  @ApiProperty({ enum: MANUAL_MOVEMENT_TYPES })
  @IsIn(MANUAL_MOVEMENT_TYPES)
  type!: ManualMovementType;

  @ApiProperty({ example: 5000, description: 'Valor em centavos, sempre > 0' })
  @IsInt()
  @Min(1)
  @Max(MAX_CASH_AMOUNT_CENTS)
  amountCents!: number;

  // Required for WITHDRAWAL (sangria), optional for SUPPLY.
  @ApiPropertyOptional()
  @ValidateIf((dto: CreateCashMovementDto) => dto.type === 'WITHDRAWAL' || dto.reason !== undefined)
  @IsString()
  @MinLength(3, { message: 'Motivo é obrigatório para sangria (mín. 3 caracteres).' })
  @MaxLength(200)
  reason?: string;
}
