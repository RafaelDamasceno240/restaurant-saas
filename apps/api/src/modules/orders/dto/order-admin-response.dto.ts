import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeliveryStatus, FulfillmentType, OrderSource, OrderStatus, PaymentMethod, TabItemStatus } from '@prisma/client';
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
  // Link to the customer registry (null for guest orders). Only the id: the registry data
  // itself is read through /customers, which has its own permission.
  @ApiPropertyOptional({ nullable: true }) customerId!: string | null;
  @ApiProperty({ enum: FulfillmentType }) fulfillmentType!: FulfillmentType;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ example: 49.8 }) subtotal!: number;
  // Discount from a coupon over the items subtotal (0 without coupon); total = subtotal - discount + deliveryFee.
  @ApiProperty({ example: 5 }) discount!: number;
  @ApiPropertyOptional({ nullable: true }) couponCode!: string | null;
  // Cashback balance of the linked customer spent on the items (0 when none);
  // total = subtotal - discount - cashbackUsed + deliveryFee.
  @ApiProperty({ example: 0 }) cashbackUsed!: number;
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

// B9: an item of a table round still in the kitchen's hands. `quantity` is what is still to be
// made (cancelled units left out).
export class KitchenRoundItemDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ enum: ['SENT', 'PREPARING', 'READY'] }) status!: TabItemStatus;
}

// B9: one round sent from a table ("Mesa 4 · rodada 2"), with only its items still in production.
// Its status is the least advanced of them: the card sits in that column and its action moves
// exactly those items.
export class KitchenTableRoundDto {
  @ApiProperty() id!: string;
  @ApiProperty() tabId!: string;
  @ApiProperty() roundNumber!: number;
  @ApiProperty() tableNumber!: number;
  @ApiPropertyOptional({ nullable: true }) tableName!: string | null;
  @ApiProperty() sentAt!: Date;
  @ApiProperty({ enum: ['SENT', 'PREPARING', 'READY'] }) status!: TabItemStatus;
  @ApiProperty({ type: [KitchenRoundItemDto] }) items!: KitchenRoundItemDto[];
}

// One column of the kitchen board: the newest orders in that status (capped) and how many
// there are in all, so the screen can say when it is not showing everything. B9: plus the table
// rounds in the same stage (SENT rounds sit in the PENDING column - "Novo" - since there is
// nothing to accept: their stock was taken when they were sent; CONFIRMED has none).
export class OrdersBoardColumnDto {
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ type: [OrderListItemDto] }) data!: OrderListItemDto[];
  @ApiProperty() total!: number;
  @ApiProperty({ type: [KitchenTableRoundDto] }) tableRounds!: KitchenTableRoundDto[];
  @ApiProperty() tableRoundsTotal!: number;
}

export class OrdersBoardResponseDto {
  @ApiProperty({ type: [OrdersBoardColumnDto] }) columns!: OrdersBoardColumnDto[];
  @ApiProperty({ description: 'Máximo de pedidos devolvidos por coluna' }) columnLimit!: number;
}

export class OrderDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ enum: OrderSource }) source!: OrderSource;
  @ApiProperty() branchId!: string;
  @ApiPropertyOptional({ nullable: true }) customerName!: string | null;
  @ApiPropertyOptional({ nullable: true }) customerPhone!: string | null;
  // Link to the customer registry (null for guest orders). Only the id: the registry data
  // itself is read through /customers, which has its own permission.
  @ApiPropertyOptional({ nullable: true }) customerId!: string | null;
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
  // Cashback balance of the linked customer spent on the items (0 when none);
  // total = subtotal - discount - cashbackUsed + deliveryFee.
  @ApiProperty({ example: 0 }) cashbackUsed!: number;
  @ApiProperty({ example: 5 }) deliveryFee!: number;
  @ApiProperty({ example: 54.8 }) total!: number;
  @ApiPropertyOptional({ type: OrderDeliverySummaryDto, nullable: true }) delivery!: OrderDeliverySummaryDto | null;
  @ApiProperty() createdAt!: Date;
}
