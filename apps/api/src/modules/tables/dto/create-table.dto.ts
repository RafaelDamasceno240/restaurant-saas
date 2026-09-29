import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class CreateTableDto {
  // Fatia 09: the branch this table physically belongs to. Validated
  // server-side against the caller (BranchAccessService) — never trusted as-is.
  @ApiProperty({ description: 'Unidade onde a mesa está' })
  @IsUUID()
  branchId!: string;

  @ApiProperty({ example: 12, description: 'Número da mesa — único dentro da unidade' })
  @IsInt()
  @Min(1)
  number!: number;

  @ApiPropertyOptional({ example: 'Varanda' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
