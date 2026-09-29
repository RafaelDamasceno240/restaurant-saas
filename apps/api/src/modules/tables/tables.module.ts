import { Module } from '@nestjs/common';
import { TablesController } from './tables.controller';
import { TablesService } from './tables.service';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [TablesController],
  providers: [TablesService],
  // Exported for TabsService (validating a tableId belongs to the tenant/branch a tab is being opened for).
  exports: [TablesService],
})
export class TablesModule {}
