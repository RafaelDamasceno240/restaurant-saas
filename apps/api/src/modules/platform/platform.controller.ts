import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { ProvisionTenantDto } from '../tenants/dto/provision-tenant.dto';
import { ListPlatformTenantsQueryDto, SuspendTenantDto } from './dto/platform.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformRequestMeta, PlatformTenantsService } from './platform-tenants.service';

// Administration of the PLATFORM: the only routes that reach across tenants, all under
// /v1/platform and all behind PlatformAdminGuard (anonymous 401 from the global JWT guard, any
// other account 403, OWNER and ADMIN included). The tenantId in the caller's token is never
// used to choose data here; the tenant routes elsewhere are untouched and stay tenant-scoped.
@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly tenants: PlatformTenantsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Restaurantes da plataforma por situação' })
  overview() {
    return this.tenants.overview();
  }

  @Get('tenants')
  @ApiOperation({
    summary: 'Lista paginada de restaurantes, com busca por nome, slug ou e-mail do OWNER',
  })
  list(@Query() query: ListPlatformTenantsQueryDto) {
    return this.tenants.list(query);
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: 'Detalhe de um restaurante (documento mascarado, sem dados sensíveis)' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.detail(id);
  }

  @Post('tenants')
  @ApiOperation({
    summary: 'Cria um restaurante pelo mesmo provisionamento do CLI (delivery desligado)',
  })
  create(
    @CurrentUser() admin: AuthenticatedRequestUser,
    @Body() dto: ProvisionTenantDto,
    @Req() req: Request,
  ) {
    return this.tenants.create(admin, dto, meta(req));
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspende o restaurante (nada é apagado) e encerra as sessões dele' })
  suspend(
    @CurrentUser() admin: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendTenantDto,
    @Req() req: Request,
  ) {
    return this.tenants.suspend(admin, id, dto.reason, meta(req));
  }

  @Post('tenants/:id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reativa um restaurante suspenso, na situação que ele tinha antes' })
  reactivate(
    @CurrentUser() admin: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.tenants.reactivate(admin, id, meta(req));
  }
}

function meta(req: Request): PlatformRequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
}
