import { ApiProperty } from '@nestjs/swagger';

// Explicit, hand-shaped response — never the raw Prisma object. Only fields
// a customer should see. No tenantId, no active/displayOrder flags, no
// fiscal/internal data of any kind.
export class PublicMenuAddressDto {
  @ApiProperty({ nullable: true }) street!: string | null;
  @ApiProperty({ nullable: true }) number!: string | null;
  @ApiProperty({ nullable: true }) complement!: string | null;
  @ApiProperty({ nullable: true }) neighborhood!: string | null;
  @ApiProperty({ nullable: true }) city!: string | null;
  @ApiProperty({ nullable: true, example: 'MG' }) state!: string | null;
  @ApiProperty({ nullable: true, example: '01310100' }) zipCode!: string | null;
}

export class PublicMenuOpeningIntervalDto {
  @ApiProperty({ example: 5, description: '0 = domingo ... 6 = sábado' }) weekday!: number;
  @ApiProperty({ example: '18:00' }) opens!: string;
  @ApiProperty({ example: '02:00', description: 'Antes da abertura = depois da meia-noite' })
  closes!: string;
}

// The public part of the restaurant profile: what the restaurant chose to publish. Never the
// e-mail, the legal name or the document.
export class PublicMenuRestaurantDto {
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ nullable: true }) description!: string | null;
  @ApiProperty({ nullable: true, example: '1134567890', description: 'Só dígitos' }) phone!:
    string | null;
  @ApiProperty({ nullable: true, example: '11987654321', description: 'Só dígitos' }) whatsapp!:
    string | null;
  @ApiProperty({ nullable: true, example: 'docehamburgueria', description: 'Sem "@"' }) instagram!:
    string | null;
  @ApiProperty({ type: PublicMenuAddressDto, nullable: true })
  address!: PublicMenuAddressDto | null;
  @ApiProperty({
    type: [PublicMenuOpeningIntervalDto],
    nullable: true,
    description: 'null = não informado',
  })
  openingHours!: PublicMenuOpeningIntervalDto[] | null;
  @ApiProperty({
    nullable: true,
    description: 'No fuso do restaurante; null quando os horários não foram informados',
  })
  openNow!: boolean | null;
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
