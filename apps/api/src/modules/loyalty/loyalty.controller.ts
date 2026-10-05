import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { LoyaltyService } from './loyalty.service';
import {
  AdjustLoyaltyPointsDto,
  CreateLoyaltyRewardDto,
  ListLoyaltyEntriesQueryDto,
  ListLoyaltyRewardsQueryDto,
  RedeemLoyaltyRewardDto,
  ReverseLoyaltyEntryDto,
  UpdateLoyaltyProgramDto,
  UpdateLoyaltyRewardDto,
} from './dto/loyalty.dto';

// tenantId always comes from the JWT (@CurrentUser); no route, query or body field carries it.
// Points are never sent by a client as "the balance": every amount is decided here (the order
// for EARN, the reward for REDEEM) except the manual adjustment, which has its own permission.
@ApiTags('loyalty')
@ApiBearerAuth()
@Controller('loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get('program')
  @RequirePermissions('loyalty.read')
  @ApiOperation({ summary: 'Configuração do programa de pontos do restaurante' })
  getProgram(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.loyalty.getProgram(user);
  }

  @Put('program')
  @RequirePermissions('loyalty.configure')
  @ApiOperation({ summary: 'Liga/desliga o programa e define os pontos por real' })
  updateProgram(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: UpdateLoyaltyProgramDto) {
    return this.loyalty.updateProgram(user, dto);
  }

  @Get('rewards')
  @RequirePermissions('loyalty.read')
  @ApiOperation({ summary: 'Catálogo de recompensas' })
  listRewards(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListLoyaltyRewardsQueryDto) {
    return this.loyalty.listRewards(user, query);
  }

  @Post('rewards')
  @RequirePermissions('loyalty.configure')
  @ApiOperation({ summary: 'Cria uma recompensa' })
  createReward(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateLoyaltyRewardDto) {
    return this.loyalty.createReward(user, dto);
  }

  @Patch('rewards/:id')
  @RequirePermissions('loyalty.configure')
  @ApiOperation({ summary: 'Edita, desativa (active=false) ou reativa uma recompensa' })
  updateReward(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLoyaltyRewardDto,
  ) {
    return this.loyalty.updateReward(user, id, dto);
  }

  @Get('customers/:customerId')
  @RequirePermissions('loyalty.read')
  @ApiOperation({ summary: 'Saldo de pontos do cliente' })
  getAccount(@CurrentUser() user: AuthenticatedRequestUser, @Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.loyalty.getAccount(user, customerId);
  }

  @Get('customers/:customerId/entries')
  @RequirePermissions('loyalty.read')
  @ApiOperation({ summary: 'Extrato de pontos do cliente (mais recente primeiro)' })
  listEntries(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: ListLoyaltyEntriesQueryDto,
  ) {
    return this.loyalty.listEntries(user, customerId, query);
  }

  @Post('customers/:customerId/redeem')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('loyalty.redeem')
  @ApiOperation({ summary: 'Troca pontos por uma recompensa (idempotente pela chave)' })
  redeem(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: RedeemLoyaltyRewardDto,
  ) {
    return this.loyalty.redeem(user, customerId, dto);
  }

  @Post('customers/:customerId/adjust')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('loyalty.adjust')
  @ApiOperation({ summary: 'Ajuste manual de pontos, com motivo (idempotente pela chave)' })
  adjust(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AdjustLoyaltyPointsDto,
  ) {
    return this.loyalty.adjust(user, customerId, dto);
  }

  @Post('entries/:id/reverse')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('loyalty.adjust')
  @ApiOperation({ summary: 'Estorna uma movimentação (uma única vez), com motivo' })
  reverse(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseLoyaltyEntryDto,
  ) {
    return this.loyalty.reverse(user, id, dto);
  }
}
