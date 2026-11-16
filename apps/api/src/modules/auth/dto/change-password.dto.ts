import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'Sup3rSecret!' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ example: 'N0vaSenha!' })
  @IsString()
  @MinLength(8, { message: 'newPassword deve ter ao menos 8 caracteres' })
  @MaxLength(128)
  newPassword!: string;
}
