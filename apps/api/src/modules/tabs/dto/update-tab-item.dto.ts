import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Only quantity/notes are editable — productId and its price snapshot are
// immutable once the item exists (removing and re-adding is the correct
// path to change the product).
export class UpdateTabItemDto {
  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantity?: number;

  @ApiPropertyOptional({ example: 'Sem cebola' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  notes?: string;
}
