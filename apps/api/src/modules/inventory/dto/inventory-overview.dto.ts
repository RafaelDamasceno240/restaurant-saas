import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class BranchQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
}

export class SummaryQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiPropertyOptional({ description: 'Início do período (padrão: 30 dias atrás)' }) @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Fim do período (padrão: agora)' }) @IsOptional() @IsDateString() to?: string;
}

export class UpdateInventorySettingsDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsBoolean() allowNegativeStock!: boolean;
}
