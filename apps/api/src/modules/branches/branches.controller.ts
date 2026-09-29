import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { BranchesService } from './branches.service';
import { BranchAccessService } from './branch-access.service';

@ApiTags('branches')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly branchesService: BranchesService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // Declared BEFORE ':id' so it isn't captured as an id. Auth-only (no extra
  // permission): returns just the branches the caller may operate — used by
  // the PDV/Caixa branch selector for any staff role (e.g. CASHIER, which
  // doesn't have restaurant.read).
  @Get('accessible')
  @ApiOperation({ summary: 'Unidades que o usuário autenticado pode operar' })
  findAccessible(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.branchAccess.listAccessible(user);
  }

  @Get()
  @RequirePermissions('restaurant.read')
  @ApiOperation({ summary: 'Lista unidades do tenant autenticado' })
  findAll(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.branchesService.findAllForTenant(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions('restaurant.read')
  @ApiOperation({ summary: 'Busca uma unidade — 404 se pertencer a outro tenant' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.branchesService.findOneForTenant(user.tenantId, id);
  }
}
