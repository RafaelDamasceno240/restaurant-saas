import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, ValidateIf } from 'class-validator';

// The ONLY field: which customer of the registry this order belongs to, or null to remove the
// link. The order's own customerName/customerPhone (what was typed at order time) are a
// snapshot and are never changed through here; tenantId comes from the token.
export class SetOrderCustomerDto {
  @ApiProperty({ nullable: true, description: 'Id do cliente cadastrado, ou null para desvincular' })
  @ValidateIf((dto: SetOrderCustomerDto) => dto.customerId !== null)
  @IsUUID()
  customerId!: string | null;
}
