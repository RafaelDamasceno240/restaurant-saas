import { Module } from '@nestjs/common';
import { CashbackModule } from '../cashback/cashback.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { OrderEffectsService } from './order-effects.service';

// Imported by the modules that move orders (orders, delivery, order creation); it imports the
// benefit modules. The dependency only ever points this way.
@Module({
  imports: [CashbackModule, LoyaltyModule],
  providers: [OrderEffectsService],
  exports: [OrderEffectsService],
})
export class OrderEffectsModule {}
