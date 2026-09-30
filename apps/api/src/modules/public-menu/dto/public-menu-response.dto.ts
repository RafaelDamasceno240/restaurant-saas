import { ApiProperty } from '@nestjs/swagger';

// Explicit, hand-shaped response — never the raw Prisma object. Only fields
// a customer should see. No tenantId, no active/displayOrder flags, no
// fiscal/internal data of any kind.
export class PublicMenuRestaurantDto {
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
}

// Delivery terms of the branch that receives online orders. Informational for
// the checkout screen only — the server recomputes and enforces them on order.
export class PublicMenuDeliveryDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ example: 5 }) fee!: number;
  @ApiProperty({ example: 20 }) minOrder!: number;
}

export class PublicMenuProductDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ example: 24.9 }) price!: number;
  @ApiProperty({ nullable: true }) imageUrl!: string | null;
}

export class PublicMenuCategoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ type: [PublicMenuProductDto] }) products!: PublicMenuProductDto[];
}

export class PublicMenuResponseDto {
  @ApiProperty({ type: PublicMenuRestaurantDto }) restaurant!: PublicMenuRestaurantDto;
  @ApiProperty({ type: PublicMenuDeliveryDto }) delivery!: PublicMenuDeliveryDto;
  @ApiProperty({ type: [PublicMenuCategoryDto] }) categories!: PublicMenuCategoryDto[];
}
