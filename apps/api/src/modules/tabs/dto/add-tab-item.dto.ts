import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

// Deliberately minimal — same structural guarantee as CreateOrderDto /
// CreatePosOrderDto: no price/name field exists here at all, so a
// client-supplied price is structurally impossible to reach the service.
// The backend always looks up Product itself and snapshots name/price.
export class AddTabItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  @Max(50)
  quantity!: number;

  @ApiPropertyOptional({ example: 'Sem cebola' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
