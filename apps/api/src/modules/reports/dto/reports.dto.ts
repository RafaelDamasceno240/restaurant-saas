import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const MAX_REPORT_PAGE_SIZE = 100;

// tenantId never appears in any of these: it comes from the token. Whether the dates are real
// calendar days, and how long the period may be, is checked by resolvePeriod (one rule for all).
export class ReportPeriodQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Primeiro dia (YYYY-MM-DD, no fuso do restaurante). Padrão: 30 dias até hoje.' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'from deve estar no formato YYYY-MM-DD.' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Último dia, inclusive (YYYY-MM-DD). Padrão: hoje.' })
  @IsOptional()
  @IsString()
  @Matches(DATE_ONLY, { message: 'to deve estar no formato YYYY-MM-DD.' })
  to?: string;

  @ApiPropertyOptional({ description: 'Uma unidade. Sem ela: todas as unidades que o usuário acessa.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class PagedReportQueryDto extends ReportPeriodQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_REPORT_PAGE_SIZE, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_REPORT_PAGE_SIZE)
  pageSize?: number;
}

export const PRODUCT_REPORT_SORTS = ['revenue', 'quantity'] as const;
export type ProductReportSort = (typeof PRODUCT_REPORT_SORTS)[number];

export class ProductsReportQueryDto extends PagedReportQueryDto {
  @ApiPropertyOptional({ enum: PRODUCT_REPORT_SORTS, default: 'revenue' })
  @IsOptional()
  @IsIn(PRODUCT_REPORT_SORTS)
  sort?: ProductReportSort;

  @ApiPropertyOptional({ description: 'Parte do nome do produto' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

export const CUSTOMER_REPORT_SORTS = ['total', 'orders'] as const;
export type CustomerReportSort = (typeof CUSTOMER_REPORT_SORTS)[number];

export class CustomersReportQueryDto extends PagedReportQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_REPORT_SORTS, default: 'total' })
  @IsOptional()
  @IsIn(CUSTOMER_REPORT_SORTS)
  sort?: CustomerReportSort;
}

export const INVENTORY_REPORT_SORTS = ['consumption', 'loss', 'name'] as const;
export type InventoryReportSort = (typeof INVENTORY_REPORT_SORTS)[number];

export class InventoryReportQueryDto extends PagedReportQueryDto {
  @ApiPropertyOptional({ enum: INVENTORY_REPORT_SORTS, default: 'consumption' })
  @IsOptional()
  @IsIn(INVENTORY_REPORT_SORTS)
  sort?: InventoryReportSort;

  @ApiPropertyOptional({ description: 'Parte do nome do insumo' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  search?: string;
}
