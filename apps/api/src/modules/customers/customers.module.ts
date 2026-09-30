import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
