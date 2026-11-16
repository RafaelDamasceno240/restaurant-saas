import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { CashModule } from '../cash/cash.module';
import { ReceivablesController } from './receivables.controller';
import { ReceivablesService } from './receivables.service';

// Depends on the cash register (a debt paid in cash goes through the drawer) and on nothing of
// the order flows: they depend on it, through OrderEffectsModule and OrderCreationModule.
@Module({
  imports: [AuditModule, BranchesModule, CashModule],
  controllers: [ReceivablesController],
  providers: [ReceivablesService],
  exports: [ReceivablesService],
})
export class ReceivablesModule {}
