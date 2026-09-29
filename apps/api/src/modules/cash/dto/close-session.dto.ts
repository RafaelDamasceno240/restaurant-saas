import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_CASH_AMOUNT_CENTS } from './open-session.dto';

// ONLY the physical count. expectedClosingBalanceCents / differenceCents are
// backend-owned: sending them is rejected by the global ValidationPipe
// (forbidNonWhitelisted) — never silently accepted, never used.
export class CloseCashSessionDto {
  @ApiProperty({ example: 15230, description: 'Valor contado fisicamente, em centavos' })
  @IsInt()
  @Min(0)
  @Max(MAX_CASH_AMOUNT_CENTS)
  countedClosingBalanceCents!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
