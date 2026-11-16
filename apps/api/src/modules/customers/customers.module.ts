import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerLookupService } from './customer-lookup.service';

@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerLookupService],
  // Every flow that attaches a customer to an order goes through the same lookup.
  exports: [CustomerLookupService],
})
export class CustomersModule {}
