import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

@Module({
  imports: [BranchesModule],
  controllers: [PublicMenuController],
  providers: [PublicMenuService],
  // The WhatsApp assistant answers from exactly the public menu.
  exports: [PublicMenuService],
})
export class PublicMenuModule {}
