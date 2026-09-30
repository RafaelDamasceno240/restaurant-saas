import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { DeliveryStatus, OrderStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const MAX_DELIVERY_FEE_CENTS = 1_000_000;
export const MAX_DELIVERY_MIN_ORDER_CENTS = 100_000_000;
export const MAX_DELIVERY_TEXT = 300;
export const MAX_PAGE_SIZE = 100;
// Offset pagination is bounded: page * pageSize can never reach beyond 100_000 rows.
export const MAX_PAGE = 1000;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListDeliveriesQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiPropertyOptional({ enum: DeliveryStatus }) @IsOptional() @IsEnum(DeliveryStatus) status?: DeliveryStatus;
  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) orderStatus?: OrderStatus;

  @ApiPropertyOptional({ description: 'Número do pedido ou nome do cliente (contém, sem diferenciar maiúsculas)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: '2026-10-01T03:00:00.000Z', description: 'Início (inclusive) da data de criação' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-02T02:59:59.999Z', description: 'Fim (inclusive) da data de criação' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE) page?: number;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}

export class DeliverySettingsQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
}

// Full replace of the three delivery settings of a branch. Money is integer
// cents; the fee/minimum are validated here and applied only by the server.
export class UpdateDeliverySettingsDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiProperty() @IsBoolean() enabled!: boolean;

  @ApiProperty({ example: 500, description: 'Taxa de entrega em centavos' })
  @IsInt()
  @Min(0)
  @Max(MAX_DELIVERY_FEE_CENTS)
  feeCents!: number;

  @ApiProperty({ example: 2000, description: 'Pedido mínimo (soma dos itens) em centavos' })
  @IsInt()
  @Min(0)
  @Max(MAX_DELIVERY_MIN_ORDER_CENTS)
  minOrderCents!: number;
}

export class FailDeliveryDto {
  @ApiProperty({ example: 'Cliente ausente', description: 'Motivo da falha (3 a 300 caracteres)' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(MAX_DELIVERY_TEXT)
  reason!: string;
}

// `null` (or blank text) clears the observation. The key itself is required so an empty
// body can never wipe it by accident.
export class UpdateDeliveryNotesDto {
  @ApiProperty({ nullable: true, example: 'Interfone 204', description: 'Observação da entrega (até 300 caracteres)' })
  @ValidateIf((dto: UpdateDeliveryNotesDto) => dto.notes !== null)
  @Transform(trim)
  @IsString()
  @MaxLength(MAX_DELIVERY_TEXT)
  notes!: string | null;
}
