import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ASSIGNABLE_ROLES, AssignableRole } from '../user-rules';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const PASSWORD_MIN = 8;
// argon2 accepts far more; this only keeps a request from making the server hash megabytes.
const PASSWORD_MAX = 128;
const MAX_BRANCHES = 50;

export class CreateUserDto {
  @ApiProperty({ example: 'Ana Caixa' })
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'ana@example.com' })
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Sup3rSecret!', description: 'Senha inicial, definida por quem cadastra' })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: 'password deve ter ao menos 8 caracteres' })
  @MaxLength(PASSWORD_MAX)
  password!: string;

  @ApiProperty({ enum: ASSIGNABLE_ROLES })
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;

  @ApiPropertyOptional({
    type: [String],
    description: 'Unidades em que a pessoa trabalha. Dispensável quando o restaurante tem uma só.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_BRANCHES)
  @IsUUID('all', { each: true })
  branchIds?: string[];
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: ASSIGNABLE_ROLES })
  @IsOptional()
  @IsIn(ASSIGNABLE_ROLES)
  role?: AssignableRole;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(MAX_BRANCHES)
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @ApiPropertyOptional({ description: 'false inativa a conta (não entra mais); true reativa' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ResetUserPasswordDto {
  @ApiProperty({ example: 'N0vaSenha!' })
  @IsString()
  @MinLength(PASSWORD_MIN, { message: 'password deve ter ao menos 8 caracteres' })
  @MaxLength(PASSWORD_MAX)
  password!: string;
}
