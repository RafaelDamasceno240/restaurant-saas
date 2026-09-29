import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateTableDto } from './create-table.dto';

// branchId is deliberately not editable — moving a physical table to a
// different branch isn't a supported operation; delete and recreate instead.
export class UpdateTableDto extends PartialType(OmitType(CreateTableDto, ['branchId'] as const)) {}
