import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { TabStatus } from '@prisma/client';

export class ListTabsQueryDto {
  // Same reasoning as ListTablesQueryDto: a comandas screen is always
  // scoped to one operating unit, not a cross-branch report.
  @ApiProperty()
  @IsUUID()
  branchId!: string;

  // Defaults to OPEN in the service — "listar abertas por padrão" per spec.
  @ApiPropertyOptional({ enum: TabStatus })
  @IsOptional()
  @IsEnum(TabStatus)
  status?: TabStatus;
}
