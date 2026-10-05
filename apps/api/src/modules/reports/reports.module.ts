import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// Reads what the other modules wrote; depends on none of their services (only on the branch
// access rule) and nothing depends on it.
@Module({
  imports: [BranchesModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
