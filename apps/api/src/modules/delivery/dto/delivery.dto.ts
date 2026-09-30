import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { DeliveryStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const MAX_DELIVERY_FEE_CENTS = 1_000_000;
export const MAX_DELIVERY_MIN_ORDER_CENTS = 100_000_000;

export class ListDeliveriesQueryDto {
  @ApiProperty() @IsUUID() branchId!: string;
  @ApiPropertyOptional({ enum: DeliveryStatus }) @IsOptional() @IsEnum(DeliveryStatus) status?: DeliveryStatus;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
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
