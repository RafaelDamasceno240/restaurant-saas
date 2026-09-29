import { ApiProperty } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';

export class AuthUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() tenantId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: RoleName, isArray: true }) roles!: RoleName[];
}

export class AuthResponseDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() expiresIn!: number;
  @ApiProperty({ type: AuthUserDto }) user!: AuthUserDto;
}
