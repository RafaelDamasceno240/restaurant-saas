import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashRegisterService } from './cash-register.service';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [CashController],
  providers: [CashRegisterService],
  // Exported for OrderCreationService (CASH sale inside the order transaction).
  exports: [CashRegisterService],
})
export class CashModule {}
