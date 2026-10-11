import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { OrderStatus } from '@prisma/client';

export class ListOrdersQueryDto {
  // Optional narrowing within the caller's own tenant (tenant scoping itself
  // always comes from the JWT).
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;

  @ApiPropertyOptional({ enum: OrderStatus })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Capped so a client can't force-load an unbounded result set.
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

// The kitchen board takes no status, page or size: what it shows is fixed (see
// ORDER_BOARD_STATUSES), so a client cannot turn it into an unbounded listing.
export class OrdersBoardQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}
