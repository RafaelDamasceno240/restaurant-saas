import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTabDto {
  // Re-validated server-side against the caller (BranchAccessService) —
  // never trusted as-is. Also the scope tableId is checked against.
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  @ApiProperty()
  @IsUUID()
  tableId!: string;

  @ApiPropertyOptional({ example: 'Mesa da janela' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customerName?: string;
}
