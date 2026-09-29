import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Do\u2019c\u00ea Hamburgueria' })
  @IsString()
  @MinLength(2)
  tenantName!: string;

  @ApiProperty({ example: 'Do\u2019c\u00ea Alimentos LTDA' })
  @IsString()
  @MinLength(2)
  legalName!: string;

  @ApiProperty({ example: '12345678000199', description: 'CNPJ/CPF, somente números' })
  @IsString()
  @Matches(/^\d{11}$|^\d{14}$/, { message: 'document deve ter 11 (CPF) ou 14 (CNPJ) dígitos' })
  document!: string;

  @ApiProperty({ example: 'doce-hamburgueria' })
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug deve conter apenas letras minúsculas, números e hífens',
  })
  slug!: string;

  @ApiProperty({ example: 'Unidade Centro' })
  @IsString()
  @MinLength(2)
  branchName!: string;

  @ApiProperty({ example: 'Maria Silva' })
  @IsString()
  @MinLength(2)
  userName!: string;

  @ApiProperty({ example: 'maria@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Sup3rSecret!' })
  @IsString()
  @MinLength(8, { message: 'password deve ter ao menos 8 caracteres' })
  password!: string;
}
