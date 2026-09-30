import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => {
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' ? null : text;
};

export class CreateSupplierDto {
  @ApiProperty({ example: 'Distribuidora Central' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(30) document?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsEmail() @MaxLength(120) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(30) document?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(30) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsEmail() @MaxLength(120) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(500) notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

export class ListSuppliersQueryDto {
  @ApiPropertyOptional({ description: 'Inclui fornecedores inativos' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;

  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MaxLength(120) search?: string;
}
