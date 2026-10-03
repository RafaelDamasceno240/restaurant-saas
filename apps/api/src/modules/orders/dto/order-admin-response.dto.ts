import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryStatus, FulfillmentType, OrderSource, OrderStatus, PaymentMethod } from '@prisma/client';
import {
  OrderAddressResponseDto,
  OrderItemResponseDto,
} from '../../public-orders/dto/order-response.dto';

// This is the AUTHENTICATED, staff-facing shape — unlike the public
// confirmation DTO, showing customerName/customerPhone here is correct and
// necessary (staff need to be able to call the customer). See
// docs/PROJECT_STATUS.md "Fatia 05" for the contrast with the public fix.
//
// customerName/customerPhone are nullable as of fatia 07: a COUNTER (PDV)
// sale can have no customer identification at all. ONLINE orders (fatia 04
// checkout) still always populate both — nothing changes for them.

// Operational summary of the order's delivery (null for PICKUP / DINE_IN).
export class OrderDeliverySummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: DeliveryStatus }) status!: DeliveryStatus;
  @ApiPropertyOptional({ nullable: true, description: 'Observação da entrega (separada da observação do pedido)' })
  notes!: string | null;
}

export class OrderListItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ enum: OrderSource }) source!: OrderSource;
  @ApiProperty() branchId!: string;
  @ApiPropertyOptional({ nullable: true }) customerName!: string | null;
  @ApiPropertyOptional({ nullable: true }) customerPhone!: string | null;
  @ApiProperty({ enum: FulfillmentType }) fulfillmentType!: FulfillmentType;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ example: 49.8 }) subtotal!: number;
  // Discount from a coupon over the items subtotal (0 without coupon); total = subtotal - discount + deliveryFee.
  @ApiProperty({ example: 5 }) discount!: number;
  @ApiPropertyOptional({ nullable: true }) couponCode!: string | null;
  @ApiProperty({ example: 5 }) deliveryFee!: number;
  @ApiProperty({ example: 54.8 }) total!: number;
  @ApiPropertyOptional({ type: OrderDeliverySummaryDto, nullable: true }) delivery!: OrderDeliverySummaryDto | null;
  @ApiProperty() itemCount!: number;
  // Added in fatia 06: the KDS needs to show items/quantities per card
  // without an extra request per order. Reusing this same list endpoint
  // (rather than one GET /orders/:id per card) is what keeps polling every
  // few seconds from turning into N+1 requests. The admin list page (fatia
  // 05) already only reads itemCount, so this is purely additive — nothing
  // there changes.
  @ApiProperty({ type: [OrderItemResponseDto] }) items!: OrderItemResponseDto[];
  @ApiProperty() createdAt!: Date;
}

export class OrderListResponseDto {
  @ApiProperty({ type: [OrderListItemDto] }) data!: OrderListItemDto[];
  @ApiProperty() meta!: { page: number; pageSize: number; total: number; totalPages: number };
}

export class OrderDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ enum: OrderSource }) source!: OrderSource;
  @ApiProperty() branchId!: string;
  @ApiPropertyOptional({ nullable: true }) customerName!: string | null;
  @ApiPropertyOptional({ nullable: true }) customerPhone!: string | null;
  @ApiProperty({ enum: FulfillmentType }) fulfillmentType!: FulfillmentType;
  @ApiPropertyOptional({ type: OrderAddressResponseDto, nullable: true })
  address!: OrderAddressResponseDto | null;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [OrderItemResponseDto] }) items!: OrderItemResponseDto[];
  @ApiProperty({ example: 49.8 }) subtotal!: number;
  // Discount from a coupon over the items subtotal (0 without coupon); total = subtotal - discount + deliveryFee.
  @ApiProperty({ example: 5 }) discount!: number;
  @ApiPropertyOptional({ nullable: true }) couponCode!: string | null;
  @ApiProperty({ example: 5 }) deliveryFee!: number;
  @ApiProperty({ example: 54.8 }) total!: number;
  @ApiPropertyOptional({ type: OrderDeliverySummaryDto, nullable: true }) delivery!: OrderDeliverySummaryDto | null;
  @ApiProperty() createdAt!: Date;
}
