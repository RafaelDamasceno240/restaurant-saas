import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PlatformController } from './platform.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformTenantsService } from './platform-tenants.service';

// Super Admin (2026-10-28): the platform's administration, apart from every tenant module.
// Exports nothing: no tenant-scoped module can borrow its cross-tenant reads.
@Module({
  imports: [AuditModule, AuthModule, TenantsModule],
  controllers: [PlatformController],
  providers: [PlatformTenantsService, PlatformAdminGuard],
})
export class PlatformModule {}
