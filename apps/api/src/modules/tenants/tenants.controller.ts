import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { UpdateRestaurantProfileDto } from './dto/restaurant-profile.dto';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get('current')
  @RequirePermissions('restaurant.read')
  @ApiOperation({ summary: 'Retorna o tenant do usuário autenticado' })
  findCurrent(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.tenantsService.findCurrent(user.tenantId);
  }

  @Get('current/profile')
  @RequirePermissions('restaurant.read')
  @ApiOperation({
    summary:
      'Perfil do restaurante: marca, contato, endereço e horários da unidade que recebe os pedidos online',
  })
  getProfile(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.tenantsService.getProfile(user.tenantId);
  }

  @Patch('current/profile')
  @RequirePermissions('restaurant.update')
  @ApiOperation({ summary: 'Altera o perfil do restaurante (só os campos enviados)' })
  updateProfile(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: UpdateRestaurantProfileDto,
  ) {
    return this.tenantsService.updateProfile(user, dto);
  }
}
