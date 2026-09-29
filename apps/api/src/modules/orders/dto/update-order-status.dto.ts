import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { OrderStatus } from '@prisma/client';

// Deliberately the ONLY field this endpoint accepts. tenantId, prices,
// totals and customer data have no relation to a status change and are
// rejected outright by the global ValidationPipe's forbidNonWhitelisted —
// there is no override here, unlike the public checkout endpoint.
export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  status!: OrderStatus;
}
