import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchAccessService } from './branch-access.service';

@Module({
  controllers: [BranchesController],
  providers: [BranchesService, BranchAccessService],
  exports: [BranchesService, BranchAccessService],
})
export class BranchesModule {}
