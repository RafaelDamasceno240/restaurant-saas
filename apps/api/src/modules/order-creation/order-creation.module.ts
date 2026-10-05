import { Module } from '@nestjs/common';
import { OrderCreationService } from './order-creation.service';
import { AuditModule } from '../audit/audit.module';
import { CashModule } from '../cash/cash.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CouponsModule } from '../coupons/coupons.module';
import { OrderEffectsModule } from '../order-effects/order-effects.module';

@Module({
  imports: [AuditModule, CashModule, InventoryModule, CouponsModule, OrderEffectsModule],
  providers: [OrderCreationService],
  exports: [OrderCreationService],
})
export class OrderCreationModule {}
