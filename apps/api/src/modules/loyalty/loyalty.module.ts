import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyService } from './loyalty.service';

// Depends on nothing of the order flows (they depend on it, through OrderEffectsModule), so
// there is no import cycle.
@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
