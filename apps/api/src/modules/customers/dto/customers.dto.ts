import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';
import { normalizeCpf, normalizePhone, PHONE_INPUT_PATTERN } from '../customer-input';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => {
  const text = typeof value === 'string' ? value.trim() : value;
  return text === '' ? null : text;
};

// Semantic validators: the same functions the service uses to normalize, so "valid in the
// DTO" and "storable" can never disagree.
function validateBy(name: string, check: (value: unknown) => boolean, options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({ name, target: target.constructor, propertyName, options, validator: { validate: check } });
}
const IsCustomerPhone = (options?: ValidationOptions) =>
  validateBy('isCustomerPhone', (v) => typeof v === 'string' && normalizePhone(v) !== null, {
    message: 'Telefone inválido: informe de 8 a 15 dígitos.',
    ...options,
  });
const IsCpf = (options?: ValidationOptions) =>
  validateBy('isCpf', (v) => typeof v === 'string' && normalizeCpf(v) !== null, {
    message: 'CPF inválido.',
    ...options,
  });

export class CreateCustomerDto {
  @ApiProperty({ example: 'Maria Souza' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: '(11) 98765-4321' })
  @Transform(trimmed)
  @IsString()
  @Matches(PHONE_INPUT_PATTERN, { message: 'Telefone em formato inválido.' })
  @IsCustomerPhone()
  phone!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsEmail() @MaxLength(120) email?: string | null;
  @ApiPropertyOptional({ example: '529.982.247-25' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(14)
  @IsCpf()
  cpf?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(500) notes?: string | null;
}

// Every field is optional; only the ones sent are changed. `email`, `cpf` and `notes` accept
// null/"" to clear them. tenantId never appears here (forbidNonWhitelisted rejects it).
export class UpdateCustomerDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trimmed) @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(PHONE_INPUT_PATTERN, { message: 'Telefone em formato inválido.' })
  @IsCustomerPhone()
  phone?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsEmail() @MaxLength(120) email?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(14) @IsCpf() cpf?: string | null;
  @ApiPropertyOptional() @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(500) notes?: string | null;
  @ApiPropertyOptional({ description: 'false inativa o cliente; true reativa' }) @IsOptional() @IsBoolean() active?: boolean;
}

export type CustomerStatusFilter = 'active' | 'inactive' | 'all';

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ description: 'Nome, telefone, e-mail ou CPF (contém)' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'inactive', 'all'], default: 'active' })
  @IsOptional()
  @IsEnum({ active: 'active', inactive: 'inactive', all: 'all' })
  status?: CustomerStatusFilter;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

export class ListCustomerOrdersQueryDto {
  @ApiPropertyOptional({ description: 'Restringe a uma unidade (precisa ter acesso a ela)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ enum: OrderStatus }) @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
