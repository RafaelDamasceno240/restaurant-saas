import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

// The add-on groups of one product, in the order the customer sees them. Replaces the whole list.
export class SetProductOptionGroupsDto {
  @ApiProperty({
    type: [String],
    description: 'IDs dos grupos de adicionais, na ordem de exibição',
  })
  @IsArray()
  @ArrayMaxSize(20, { message: 'No máximo 20 grupos de adicionais por produto.' })
  @ArrayUnique({ message: 'O mesmo grupo foi enviado duas vezes.' })
  @IsUUID('4', { each: true })
  groupIds!: string[];
}

// The new order of every product of one category (the first id is shown first).
export class ReorderProductsDto {
  @ApiProperty()
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique({ message: 'O mesmo produto foi enviado duas vezes.' })
  @IsUUID('4', { each: true })
  productIds!: string[];
}
