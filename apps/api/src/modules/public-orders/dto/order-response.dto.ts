import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FulfillmentType, OrderStatus, PaymentMethod } from '@prisma/client';

// Explicit, hand-shaped response — never the raw Prisma row. No tenantId,
// no internal ids beyond the order's own.
export class OrderItemResponseDto {
  @ApiProperty() productId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ example: 24.9 }) unitPrice!: number;
  @ApiProperty() quantity!: number;
  @ApiProperty({ example: 49.8 }) subtotal!: number;
}

export class OrderAddressResponseDto {
  @ApiProperty() street!: string;
  @ApiProperty() number!: string;
  @ApiPropertyOptional({ nullable: true }) complement!: string | null;
  @ApiProperty() neighborhood!: string;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty() zipCode!: string;
}

// Returned ONLY by POST /public/orders, synchronously, to the very browser
// that just submitted customerName/customerPhone — the same trust boundary
// as any checkout form echoing back what you just typed. This shape must
// NEVER be reused for a route a URL/ID alone can reach later (see
// PublicOrderConfirmationDto below).
export class OrderResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty() customerName!: string;
  @ApiProperty() customerPhone!: string;
  @ApiProperty({ enum: FulfillmentType }) fulfillmentType!: FulfillmentType;
  @ApiPropertyOptional({ type: OrderAddressResponseDto, nullable: true })
  address!: OrderAddressResponseDto | null;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [OrderItemResponseDto] }) items!: OrderItemResponseDto[];
  @ApiProperty({ example: 49.8 }) subtotal!: number;
  @ApiProperty({ example: 49.8 }) total!: number;
  @ApiProperty() createdAt!: Date;
}

// Returned by GET /public/orders/:slug/:orderId — reachable by anyone who
// has (or guesses/shares/finds in browser history) the order id, with no
// authentication and no secret token yet. Deliberately narrower than
// OrderResponseDto: no customerName, no customerPhone. Delivery address is
// kept because the confirmation page's whole purpose is to confirm it back
// to the customer — dropping it would break that page, not just its data
// exposure. If this page ever needs a customer-recognizable field again,
// add a dedicated `publicOrderToken` (not implemented yet) rather than
// widening this DTO back toward personal data.
export class PublicOrderConfirmationDto {
  @ApiProperty() id!: string;
  @ApiProperty() orderNumber!: string;
  @ApiProperty({ enum: OrderStatus }) status!: OrderStatus;
  @ApiProperty({ enum: FulfillmentType }) fulfillmentType!: FulfillmentType;
  @ApiPropertyOptional({ type: OrderAddressResponseDto, nullable: true })
  address!: OrderAddressResponseDto | null;
  @ApiProperty({ enum: PaymentMethod }) paymentMethod!: PaymentMethod;
  @ApiPropertyOptional({ nullable: true }) notes!: string | null;
  @ApiProperty({ type: [OrderItemResponseDto] }) items!: OrderItemResponseDto[];
  @ApiProperty({ example: 49.8 }) subtotal!: number;
  @ApiProperty({ example: 49.8 }) total!: number;
  @ApiProperty() createdAt!: Date;
}
