import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;
const CANCEL_REASON_MESSAGE = `Informe o motivo do cancelamento (de ${CANCEL_REASON_MIN} a ${CANCEL_REASON_MAX} caracteres).`;

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// The status, plus the reason when it is a cancellation. tenantId, prices, totals and customer
// data have no relation to a status change and are rejected outright by the global
// ValidationPipe's forbidNonWhitelisted — there is no override here, unlike the public checkout
// endpoint.
export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;

  // B5 (piloto 2026-10-23): cancelling gives money back, cancels a fiado debt and returns stock,
  // and cannot be undone, so it is never done without a reason. Required for CANCELLED (spaces
  // alone do not count), recorded in the audit log with the cancellation; ignored otherwise.
  @ApiPropertyOptional({ description: `Obrigatório para CANCELLED (${CANCEL_REASON_MIN} a ${CANCEL_REASON_MAX} caracteres)` })
  @ValidateIf((dto: UpdateOrderStatusDto) => dto.status === 'CANCELLED' || dto.reason !== undefined)
  @Transform(trimmed)
  @IsString({ message: CANCEL_REASON_MESSAGE })
  @MinLength(CANCEL_REASON_MIN, { message: CANCEL_REASON_MESSAGE })
  @MaxLength(CANCEL_REASON_MAX, { message: CANCEL_REASON_MESSAGE })
  reason?: string;
}
