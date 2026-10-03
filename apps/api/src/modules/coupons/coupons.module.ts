import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { CouponRedemptionService } from './coupon-redemption.service';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';

// CouponRedemptionService is the only part other modules use (order creation, PDV and public
// previews); the administrative CRUD stays private to this module.
@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [CouponsController],
  providers: [CouponsService, CouponRedemptionService],
  exports: [CouponRedemptionService],
})
export class CouponsModule {}
