import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

// The new order of every category of the restaurant (the first id is shown first).
export class ReorderCategoriesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique({ message: 'A mesma categoria foi enviada duas vezes.' })
  @IsUUID('4', { each: true })
  categoryIds!: string[];
}
