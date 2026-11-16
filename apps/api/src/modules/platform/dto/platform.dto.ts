import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { TenantStatus } from '@prisma/client';

export const PLATFORM_PAGE_SIZE = 20;
export const SUSPENSION_REASON_MIN = 5;
export const SUSPENSION_REASON_MAX = 500;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListPlatformTenantsQueryDto {
  @ApiPropertyOptional({ description: 'Parte do nome, do slug ou do e-mail do OWNER' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: TenantStatus })
  @IsOptional()
  @IsIn(Object.values(TenantStatus))
  status?: TenantStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: PLATFORM_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

export class SuspendTenantDto {
  @ApiProperty({
    description: `Motivo da suspensão (${SUSPENSION_REASON_MIN} a ${SUSPENSION_REASON_MAX} caracteres), guardado na auditoria`,
  })
  @Transform(trim)
  @IsString()
  @MinLength(SUSPENSION_REASON_MIN)
  @MaxLength(SUSPENSION_REASON_MAX)
  reason!: string;
}
