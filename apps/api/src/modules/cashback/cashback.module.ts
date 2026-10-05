import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CashbackController } from './cashback.controller';
import { CashbackService } from './cashback.service';

// Depends on nothing of the order flows (they depend on it, through OrderEffectsModule and
// OrderCreationModule), so there is no import cycle.
@Module({
  imports: [AuditModule],
  controllers: [CashbackController],
  providers: [CashbackService],
  exports: [CashbackService],
})
export class CashbackModule {}
