import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CashRegisterService } from './cash-register.service';
import { OpenCashSessionDto } from './dto/open-session.dto';
import { CloseCashSessionDto } from './dto/close-session.dto';
import { CreateCashMovementDto } from './dto/create-movement.dto';
import { CurrentCashSessionQueryDto, ListCashSessionsQueryDto } from './dto/list-sessions-query.dto';

// Deliberately NO update/delete routes for movements and NO reopen route for
// sessions: immutability is enforced by the absence of any path to do it.
@ApiTags('cash')
@ApiBearerAuth()
@Controller('cash/sessions')
export class CashController {
  constructor(private readonly cash: CashRegisterService) {}

  @Post()
  @RequirePermissions('cash.open')
  @ApiOperation({ summary: 'Abre o caixa de uma unidade (uma sessão OPEN por unidade)' })
  open(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: OpenCashSessionDto) {
    return this.cash.open(user, dto);
  }

  @Get('current')
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'Sessão OPEN atual da unidade (ou null)' })
  current(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: CurrentCashSessionQueryDto) {
    return this.cash.getCurrent(user, query.branchId);
  }

  @Get()
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'Histórico de sessões (restrito às unidades acessíveis)' })
  list(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListCashSessionsQueryDto) {
    return this.cash.list(user, query);
  }

  @Get(':id')
  @RequirePermissions('cash.read')
  @ApiOperation({ summary: 'Detalhe de uma sessão com movimentos' })
  findOne(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.cash.findOne(user, id);
  }

  @Post(':id/movements')
  @RequirePermissions('cash.movement.create')
  @ApiOperation({ summary: 'Registra suprimento ou sangria (somente com sessão OPEN)' })
  addMovement(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: CreateCashMovementDto,
  ) {
    return this.cash.addMovement(user, id, dto);
  }

  @Patch(':id/close')
  @RequirePermissions('cash.close')
  @ApiOperation({ summary: 'Fecha o caixa — recebe só o valor contado; o resto é calculado' })
  close(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() dto: CloseCashSessionDto,
  ) {
    return this.cash.close(user, id, dto);
  }
}
